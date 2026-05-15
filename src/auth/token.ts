const encoder = new TextEncoder();

type SecretValue = string | { get(): Promise<string> };

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

async function resolveSecret(value: SecretValue | undefined): Promise<string | undefined> {
  if (value && typeof value !== "string") {
    return value.get();
  }
  return value;
}

export async function issueInternalToken(
  env: { INTERNAL_AUTH_SIGNING_KEY?: SecretValue; INTERNAL_AUTH_TOKEN_ISSUER?: string },
  input: { audience: string },
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
