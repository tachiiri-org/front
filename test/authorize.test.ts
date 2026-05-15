import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  authorizeFetch,
  hasAuthorizeConfig,
  issueInternalToken,
  type AuthorizeEnv,
} from "../src/auth";
import {
  buildGitHubOAuthStartUrl,
  exchangeGitHubOAuthCode,
  readGitHubSession,
} from "../src/identify";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(data: Uint8Array): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return decoder.decode(Buffer.from(padded, "base64"));
}

function fromBase64UrlBytes(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const bytes = Buffer.from(padded, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("authorize helpers", () => {
  let publicKeyJwk: string;
  let privateKeyJwk: string;

  beforeAll(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      configurable: true,
    });
  });

  beforeEach(async () => {
    const keyPair = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    privateKeyJwk = JSON.stringify(await crypto.subtle.exportKey("jwk", keyPair.privateKey));
    publicKeyJwk = JSON.stringify(await crypto.subtle.exportKey("jwk", keyPair.publicKey));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects authorize config only when all required bindings are present", () => {
    const base: Partial<AuthorizeEnv> = {
      AUTHORIZE: { fetch: vi.fn() },
      FRONT_TO_AUTHORIZE_TOKEN: "token",
    };

    expect(hasAuthorizeConfig(base)).toBe(false);
    expect(
      hasAuthorizeConfig({
        ...base,
        INTERNAL_AUTH_SIGNING_KEY: privateKeyJwk,
      }),
    ).toBe(true);
  });

  it("issues a bearer token signed by the configured key", async () => {
    const token = await issueInternalToken(
      {
        INTERNAL_AUTH_SIGNING_KEY: privateKeyJwk,
      },
      { audience: "authorize" },
    );

    const [headerPart, payloadPart, signaturePart] = token.split(".");
    expect(headerPart).toBeTruthy();
    expect(payloadPart).toBeTruthy();
    expect(signaturePart).toBeTruthy();

    const payload = JSON.parse(fromBase64Url(payloadPart!)) as Record<string, unknown>;
    expect(payload.aud).toBe("authorize");
    expect(payload.actor_type).toBe("service");

    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await crypto.subtle.importKey(
        "jwk",
        JSON.parse(publicKeyJwk) as JsonWebKey,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      ),
      fromBase64UrlBytes(signaturePart!),
      encoder.encode(`${headerPart}.${payloadPart}`),
    );
    expect(valid).toBe(true);
  });

  it("forwards requests through authorize with internal headers", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe("https://authorize.local/api/v1/cloudflare-r2-adapter/s3/r2_file_get");
      expect(request.headers.get("x-internal-token")).toBe("internal-token");
      expect(request.headers.get("authorization")).toMatch(/^Bearer /);
      return Response.json({ content_base64: toBase64Url(encoder.encode("ok")) });
    });

    const response = await authorizeFetch(
      {
        AUTHORIZE: { fetch },
        FRONT_TO_AUTHORIZE_TOKEN: "internal-token",
        INTERNAL_AUTH_SIGNING_KEY: privateKeyJwk,
      },
      {
        path: "/api/v1/cloudflare-r2-adapter/s3/r2_file_get",
        method: "POST",
        body: JSON.stringify({ bucket_id: "layouts-dev", key: "sample.json" }),
      },
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("builds the front GitHub OAuth start URL", () => {
    expect(
      buildGitHubOAuthStartUrl({
        FRONTEND_ORIGIN: "https://front-dev.tachiiri.workers.dev",
      }),
    ).toBe(
      "https://front-dev.tachiiri.workers.dev/oauth/github/start?scope=repo+read%3Auser",
    );
  });

  it("reads the GitHub session from identify", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "https://identify-dev.tachiiri.workers.dev/internal/github/session",
      );
      return Response.json({
        authenticated: true,
        accessToken: "github-token",
        viewer: {
          login: "octocat",
          name: "Mona",
        },
      });
    });

    vi.stubGlobal("fetch", fetch);

    await expect(
      readGitHubSession({
        IDENTIFY_ORIGIN: "https://identify-dev.tachiiri.workers.dev",
        FRONT_TO_IDENTIFY_TOKEN: "front-token",
      }),
    ).resolves.toEqual({
      authenticated: true,
      accessToken: "github-token",
      viewer: {
        login: "octocat",
        name: "Mona",
      },
    });
  });

  it("prefers IDENTIFY_ORIGIN over the identify service binding", async () => {
    const identify = {
      fetch: vi.fn(async () => new Response("should not be used", { status: 500 })),
    };

    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "https://identify-local.tachiiri.workers.dev/internal/github/session",
      );
      return Response.json({
        authenticated: true,
        accessToken: "github-token",
        viewer: {
          login: "octocat",
          name: "Mona",
        },
      });
    });

    vi.stubGlobal("fetch", fetch);

    await expect(
      readGitHubSession({
        IDENTIFY: identify,
        IDENTIFY_ORIGIN: "https://identify-local.tachiiri.workers.dev",
        FRONT_TO_IDENTIFY_TOKEN: "front-token",
      }),
    ).resolves.toEqual({
      authenticated: true,
      accessToken: "github-token",
      viewer: {
        login: "octocat",
        name: "Mona",
      },
    });

    expect(identify.fetch).not.toHaveBeenCalled();
  });

  it("prefers AUTHORIZE_ORIGIN over the authorize service binding", async () => {
    const authorize = {
      fetch: vi.fn(async () => new Response("should not be used", { status: 500 })),
    };

    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://authorize-local.tachiiri.workers.dev/health");
      return new Response("ok", { status: 200 });
    });

    vi.stubGlobal("fetch", fetch);

    await expect(
      authorizeFetch(
        {
          AUTHORIZE: authorize,
          AUTHORIZE_ORIGIN: "https://authorize-local.tachiiri.workers.dev",
          FRONT_TO_AUTHORIZE_TOKEN: "internal-token",
          INTERNAL_AUTH_SIGNING_KEY: privateKeyJwk,
        },
        { path: "/health", method: "GET" },
      ),
    ).resolves.toMatchObject({ status: 200 });

    expect(authorize.fetch).not.toHaveBeenCalled();
  });

  it("exchanges the GitHub oauth code through identify", async () => {
    const identify = {
      fetch: vi.fn(async (request: Request) => {
        expect(request.url).toBe("https://identify.internal/internal/github/oauth/callback");
        expect(request.method).toBe("POST");
        expect(request.headers.get("x-front-to-identify-token")).toBe("front-token");
        await expect(request.json()).resolves.toEqual({ code: "oauth-code" });
        return new Response(null, { status: 204 });
      }),
    };

    await expect(
      exchangeGitHubOAuthCode(
        {
          IDENTIFY: identify,
          FRONT_TO_IDENTIFY_TOKEN: "front-token",
        },
        "oauth-code",
      ),
    ).resolves.toBeUndefined();

    expect(identify.fetch).toHaveBeenCalledOnce();
  });
});
