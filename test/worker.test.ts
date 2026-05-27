import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";

import worker from "../src/worker";

beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
});

let privateKeyJwk: string;

beforeEach(async () => {
  const keyPair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  privateKeyJwk = JSON.stringify(await crypto.subtle.exportKey("jwk", keyPair.privateKey));
});

it("starts GitHub OAuth from the public front route", async () => {
  const response = await worker.fetch(
    new Request("https://front.example.com/oauth/github/start?scope=repo%20read:user"),
    {
      ASSETS: {
        fetch: async () => new Response("not used"),
      },
      FRONTEND_ORIGIN: "https://front.example.com",
      GITHUB_OAUTH_CLIENT_ID: "github-client-id",
    } as never,
  );

  expect(response.status).toBe(302);
  const location = response.headers.get("Location") ?? "";
  expect(location).toContain("https://github.com/login/oauth/authorize");
  expect(location).toContain("client_id=github-client-id");
  expect(location).toContain("redirect_uri=https%3A%2F%2Ffront.example.com%2Foauth%2Fgithub%2Fcallback");
  expect(response.headers.get("Set-Cookie")).toContain("github_explorer_oauth_state=");
});

it("exchanges the GitHub OAuth callback through backend", async () => {
  const backendFetch = vi.fn(async (request: Request) => {
    expect(request.url).toBe("https://backend.local/api/v1/identify/session/github/oauth/callback");
    expect(request.method).toBe("POST");
    const body = (await request.json()) as { code: string; redirectUri: string };
    expect(body.code).toBe("abc");
    expect(body.redirectUri).toBe("https://front.example.com/oauth/github/callback");
    return new Response(null, { status: 204 });
  });

  const response = await worker.fetch(
    new Request("https://front.example.com/oauth/github/callback?code=abc&state=xyz", {
      headers: {
        Cookie: "github_explorer_oauth_state=xyz",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("not used"),
      },
      FRONTEND_ORIGIN: "https://front.example.com",
      FRONT_TO_BACKEND_TOKEN: "backend-token",
      INTERNAL_AUTH_SIGNING_KEY: privateKeyJwk,
      BACKEND: { fetch: backendFetch },
    } as never,
  );

  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(
    "https://front.example.com/?tab=openapi-explorer",
  );
  expect(backendFetch).toHaveBeenCalledOnce();
});

it("accepts the legacy GitHub OAuth callback path", async () => {
  const backendFetch = vi.fn(async (request: Request) => {
    expect(request.url).toBe("https://backend.local/api/v1/identify/session/github/oauth/callback");
    expect(request.method).toBe("POST");
    return new Response(null, { status: 204 });
  });

  const response = await worker.fetch(
    new Request("https://front.example.com/github/oauth/callback?code=abc&state=xyz", {
      headers: {
        Cookie: "github_explorer_oauth_state=xyz",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("not used"),
      },
      FRONTEND_ORIGIN: "https://front.example.com",
      FRONT_TO_BACKEND_TOKEN: "backend-token",
      INTERNAL_AUTH_SIGNING_KEY: privateKeyJwk,
      BACKEND: { fetch: backendFetch },
    } as never,
  );

  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(
    "https://front.example.com/?tab=openapi-explorer",
  );
  expect(backendFetch).toHaveBeenCalledOnce();
});
