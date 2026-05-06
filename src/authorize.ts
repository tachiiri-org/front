const encoder = new TextEncoder();

export type AuthorizeEnv = {
  readonly AUTHORIZE?: {
    fetch(request: Request): Promise<Response>;
  };
  readonly FRONT_TO_AUTHORIZE_TOKEN?: string;
  readonly INTERNAL_AUTH_SIGNING_KEY?: string;
  readonly INTERNAL_AUTH_TOKEN_ISSUER?: string;
};

type InternalTokenClaims = {
  claims_set_version: number;
  actor_id: string;
  actor_type: "human" | "service" | "ops";
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;
  tenant_id?: string;
  subject_id?: string;
  scope?: string[] | string;
  scopes?: string[] | string;
  roles?: string[];
};

function toBase64Url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

async function importSigningKey(jwkJson: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkJson) as JsonWebKey;
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

export function hasAuthorizeConfig(env: AuthorizeEnv): boolean {
  return Boolean(
    env.AUTHORIZE && env.FRONT_TO_AUTHORIZE_TOKEN && env.INTERNAL_AUTH_SIGNING_KEY,
  );
}

function sanitizeHeaders(sourceHeaders?: HeadersInit): Headers {
  const headers = new Headers(sourceHeaders);
  headers.delete("authorization");
  headers.delete("x-internal-token");
  return headers;
}

export async function issueInternalToken(
  env: AuthorizeEnv,
  input: { audience: string },
): Promise<string> {
  if (!env.INTERNAL_AUTH_SIGNING_KEY) {
    throw new Error("missing_internal_auth_signing_key");
  }

  const key = await importSigningKey(env.INTERNAL_AUTH_SIGNING_KEY);
  const now = Math.floor(Date.now() / 1000);
  const payload: InternalTokenClaims = {
    claims_set_version: 1,
    actor_id: "front-local",
    actor_type: "service",
    iss: env.INTERNAL_AUTH_TOKEN_ISSUER ?? "front",
    aud: input.audience,
    exp: now + 300,
    iat: now,
    jti: crypto.randomUUID(),
  };

  const header = { alg: "ES256", typ: "JWT" };
  const signingInput = `${toBase64Url(encoder.encode(JSON.stringify(header)))}.${toBase64Url(
    encoder.encode(JSON.stringify(payload)),
  )}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function authorizeFetch(
  env: AuthorizeEnv,
  input: {
    path: string;
    method: string;
    body?: string;
    headers?: HeadersInit;
    audience?: string;
  },
): Promise<Response> {
  if (!env.AUTHORIZE || !env.FRONT_TO_AUTHORIZE_TOKEN || !env.INTERNAL_AUTH_SIGNING_KEY) {
    return Response.json({ error: "authorize_not_configured" }, { status: 500 });
  }

  const headers = sanitizeHeaders(input.headers);
  headers.set("x-internal-token", env.FRONT_TO_AUTHORIZE_TOKEN);
  headers.set("authorization", `Bearer ${await issueInternalToken(env, {
    audience: input.audience ?? "authorize",
  })}`);
  if (input.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return env.AUTHORIZE.fetch(
    new Request(new URL(input.path, "https://authorize.local").toString(), {
      method: input.method,
      headers,
      body: input.body ?? null,
      ...(input.body ? ({ duplex: "half" } as RequestInit) : {}),
      redirect: "manual",
    }),
  );
}
