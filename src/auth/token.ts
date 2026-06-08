const encoder = new TextEncoder();

type SecretValue = string | { get(): Promise<string> };

type InternalTokenClaims = {
  claims_set_version: number;
  actor_id: string;
  actor_type: "human" | "service" | "ops" | "ai";
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

async function importVerifyKey(jwkJson: string): Promise<CryptoKey> {
  const { d: _d, key_ops: _ops, ...pub } = JSON.parse(jwkJson) as JsonWebKey;
  return crypto.subtle.importKey(
    "jwk",
    { ...pub, key_ops: ["verify"] },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  const binary = atob(base64);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

export async function verifyInternalToken(
  env: { INTERNAL_AUTH_SIGNING_KEY?: SecretValue },
  token: string,
): Promise<InternalTokenClaims | null> {
  try {
    const signingKey = await resolveSecret(env.INTERNAL_AUTH_SIGNING_KEY);
    if (!signingKey) return null;
    const key = await importVerifyKey(signingKey);
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    if (!headerB64 || !payloadB64 || !signatureB64) return null;
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      fromBase64Url(signatureB64).buffer as ArrayBuffer,
      encoder.encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as InternalTokenClaims;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function issueMcpToken(
  env: { INTERNAL_AUTH_SIGNING_KEY?: SecretValue; INTERNAL_AUTH_TOKEN_ISSUER?: string },
  input: { orgId: string; userId: string; scopes: string[]; clientId: string },
): Promise<string> {
  const signingKey = await resolveSecret(env.INTERNAL_AUTH_SIGNING_KEY);
  if (!signingKey) throw new Error("missing_internal_auth_signing_key");
  const key = await importSigningKey(signingKey);
  const now = Math.floor(Date.now() / 1000);
  const payload: InternalTokenClaims = {
    claims_set_version: 1,
    actor_id: input.clientId,
    actor_type: "ai",
    iss: env.INTERNAL_AUTH_TOKEN_ISSUER ?? "front",
    aud: "backend",
    exp: now + 7776000,
    iat: now,
    jti: crypto.randomUUID(),
    tenant_id: input.orgId,
    subject_id: input.userId,
    scopes: input.scopes,
  };
  const header = { alg: "ES256", typ: "JWT" };
  const signingInput = `${toBase64Url(encoder.encode(JSON.stringify(header)))}.${toBase64Url(encoder.encode(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

async function resolveSecret(value: SecretValue | undefined): Promise<string | undefined> {
  if (value && typeof value !== "string") {
    return value.get();
  }
  return value;
}

export async function issueInternalToken(
  env: { INTERNAL_AUTH_SIGNING_KEY?: SecretValue; INTERNAL_AUTH_TOKEN_ISSUER?: string },
  input: { audience: string; tenantId?: string; subjectId?: string; actorType?: InternalTokenClaims['actor_type']; roles?: string[] },
): Promise<string> {
  const signingKey = await resolveSecret(env.INTERNAL_AUTH_SIGNING_KEY);
  if (!signingKey) {
    throw new Error("missing_internal_auth_signing_key");
  }

  const key = await importSigningKey(signingKey);
  const now = Math.floor(Date.now() / 1000);
  const payload: InternalTokenClaims = {
    claims_set_version: 1,
    actor_id: "front-local",
    actor_type: input.actorType ?? "service",
    ...(input.roles ? { roles: input.roles } : {}),
    iss: env.INTERNAL_AUTH_TOKEN_ISSUER ?? "front",
    aud: input.audience,
    exp: now + 300,
    iat: now,
    jti: crypto.randomUUID(),
    ...(input.tenantId ? { tenant_id: input.tenantId } : {}),
    ...(input.subjectId ? { subject_id: input.subjectId } : {}),
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

export async function issueSessionToken(
  env: { INTERNAL_AUTH_SIGNING_KEY?: SecretValue },
  data: Record<string, unknown>,
  ttlSeconds = 600,
): Promise<string> {
  const signingKey = await resolveSecret(env.INTERNAL_AUTH_SIGNING_KEY);
  if (!signingKey) throw new Error("missing_internal_auth_signing_key");
  const key = await importSigningKey(signingKey);
  const now = Math.floor(Date.now() / 1000);
  const payload = { ...data, exp: now + ttlSeconds, iat: now };
  const header = { alg: "ES256", typ: "JWT" };
  const signingInput = `${toBase64Url(encoder.encode(JSON.stringify(header)))}.${toBase64Url(encoder.encode(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function readSessionToken<T extends Record<string, unknown>>(
  env: { INTERNAL_AUTH_SIGNING_KEY?: SecretValue },
  token: string,
): Promise<T | null> {
  const signingKey = await resolveSecret(env.INTERNAL_AUTH_SIGNING_KEY);
  if (!signingKey) return null;
  try {
    const key = await importVerifyKey(signingKey);
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    if (!headerB64 || !payloadB64 || !signatureB64) return null;
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      fromBase64Url(signatureB64).buffer as ArrayBuffer,
      encoder.encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return null;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as T & { exp?: number };
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}
