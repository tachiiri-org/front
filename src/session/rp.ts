// Relying-Party (product-side) OIDC flow.
//
// A product front (e.g. graph.tachiiri.com) delegates authentication to the auth origin
// (authn.tachiiri.com): unauthenticated navigation is redirected to the OP authorize
// endpoint; the OP redirects back to /auth/callback, which exchanges the code for an
// id_token and establishes the product's own __Host-identity session.
//
// Same-worker note: today authn and the product are the same worker, so the id_token is
// obtained over the back-channel from our own OP (trusted TLS response). Signature is not
// re-verified here yet; TODO: verify via the OP's JWKS once a product is a separate worker
// that no longer shares the signing key.

import { serializeCookie, parseCookies } from "./cookies";
import { identitySetCookies } from "./identity";
import type { AuthorizeEnv } from "./index";

const RP_STATE_COOKIE = "__Host-rp_state";
const RP_TTL = 600; // 10 minutes to complete the round-trip

// The auth origin for a product host: replace the product label with "authn".
// dev.graph.tachiiri.com -> dev.authn.tachiiri.com ; graph.tachiiri.com -> authn.tachiiri.com
function authnHost(hostname: string): string {
  return hostname.replace(/(^|\.)graph(\.|$)/, "$1authn$2");
}

// Product client_id = the label immediately before "tachiiri" (the product role).
// graph.tachiiri.com -> "graph" ; dev.graph.tachiiri.com -> "graph"
export function productClientId(hostname: string): string {
  const parts = hostname.split(".");
  const i = parts.indexOf("tachiiri");
  return i > 0 ? parts[i - 1] : parts[0];
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  const bin = atob(b64);
  return new Uint8Array([...bin].map((c) => c.charCodeAt(0)));
}

// Unauthenticated product navigation -> start the OIDC authorization-code (PKCE) flow.
export async function handleProductLoginRedirect(request: Request, env: AuthorizeEnv): Promise<Response> {
  void env;
  const url = new URL(request.url);
  const clientId = productClientId(url.hostname);
  const redirectUri = `https://${url.hostname}/auth/callback`;
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const returnTo = url.pathname + url.search;

  const authorize = new URL(`https://${authnHost(url.hostname)}/oauth/mcp/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", "openid");
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("state", state);

  const stateBlob = btoa(JSON.stringify({ state, verifier, returnTo }));
  const headers = new Headers({ Location: authorize.toString() });
  headers.append("Set-Cookie", serializeCookie(RP_STATE_COOKIE, stateBlob, { maxAge: RP_TTL, sameSite: "Lax" }));
  return new Response(null, { status: 302, headers });
}

// GET /auth/callback — validate state, exchange the code, establish the product session.
export async function handleAuthCallback(request: Request, env: AuthorizeEnv): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const blob = parseCookies(request).get(RP_STATE_COOKIE);
  if (!code || !state || !blob) return new Response("invalid_request", { status: 400 });

  let saved: { state: string; verifier: string; returnTo: string };
  try {
    saved = JSON.parse(atob(blob)) as { state: string; verifier: string; returnTo: string };
  } catch {
    return new Response("invalid_state", { status: 400 });
  }
  if (saved.state !== state) return new Response("state_mismatch", { status: 400 });

  const clientId = productClientId(url.hostname);
  const redirectUri = `https://${url.hostname}/auth/callback`;
  const tokenRes = await fetch(`https://${authnHost(url.hostname)}/oauth/mcp/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenRes.ok) return new Response("token_exchange_failed", { status: 502 });
  const tok = (await tokenRes.json()) as { id_token?: string };
  if (!tok.id_token) return new Response("no_id_token", { status: 502 });

  const parts = tok.id_token.split(".");
  if (parts.length !== 3) return new Response("bad_id_token", { status: 502 });
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as {
    sub?: string;
    group_id?: string;
    exp?: number;
  };
  if (!claims.sub) return new Response("no_subject", { status: 502 });
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return new Response("id_token_expired", { status: 401 });

  const returnTo = saved.returnTo && saved.returnTo.startsWith("/") ? saved.returnTo : "/";
  const headers = new Headers({ Location: returnTo });
  headers.append("Set-Cookie", serializeCookie(RP_STATE_COOKIE, "", { maxAge: 0, sameSite: "Lax" }));
  for (const c of await identitySetCookies(env, { userId: claims.sub, groupId: claims.group_id })) {
    headers.append("Set-Cookie", c);
  }
  return new Response(null, { status: 302, headers });
}

// Whether a hostname is a product host (a role label that is neither the auth origin nor
// a workers.dev app host). Used by the worker to gate the relying-party flow.
export function isProductHost(hostname: string): boolean {
  const parts = hostname.split(".");
  const i = parts.indexOf("tachiiri");
  if (i <= 0) return false; // e.g. front-dev.workers.dev
  const role = parts[i - 1];
  return role !== "" && role !== "authn";
}
