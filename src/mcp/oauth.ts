import type { AuthorizeEnv } from "../session";
import { parseCookies, serializeCookie, clearCookie } from "../session/cookies";
import { issueMcpToken, issueIdToken, getPublicJwk } from "../session/token";
import { authorizeFetch } from "../session/fetch";
import { MCP_OAUTH_PARAMS_COOKIE } from "../session/github";
import { readIdentity, identityClearCookies } from "../session/identity";
import { createOrganization, listUserOrganizations } from "../identify";

const CODE_TTL = 60 * 10; // 10 minutes

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

type McpOAuthParams = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  scope: string;
  resource: string;
};

type OAuthClient = {
  id: string;
  name: string | null;
  redirect_uris: string[];
};

function toBase64Url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

// The identity DB lives behind the backend; the front worker holds no binding to it.
// Every OAuth persistence primitive is a backend call over the internal (authorizeFetch)
// channel. These identity routes are public (auth "none").
function oauthDbFetch(env: AuthorizeEnv, method: string, path: string, body?: unknown): Promise<Response> {
  return authorizeFetch(env, { path, method, body: body === undefined ? undefined : JSON.stringify(body) });
}

function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function origin(request: Request, env: AuthorizeEnv): string {
  const url = new URL(request.url);
  // The auth/product hosts (and the workers.dev app hosts) are the OP's own canonical
  // origins, so serve per-domain discovery/issuer/endpoints from the request origin. Fall
  // back to the pinned FRONTEND_ORIGIN only for unrecognized hosts (Cloudflare already
  // routes by Host, and the suffix allowlist guards against Host spoofing besides).
  if (url.hostname.endsWith(".tachiiri.com") || url.hostname.endsWith(".workers.dev")) {
    return url.origin;
  }
  return env.FRONTEND_ORIGIN ?? url.origin;
}

// RFC 8707 resource identifier for this MCP server: the canonical /mcp URL.
export function mcpResource(request: Request, env: AuthorizeEnv): string {
  return `${origin(request, env)}/mcp`;
}

async function lookupClient(env: AuthorizeEnv, clientId: string): Promise<OAuthClient | null> {
  const res = await oauthDbFetch(env, "GET", `/api/v1/identity/oauth/clients/${encodeURIComponent(clientId)}`);
  if (!res.ok) return null;
  return res.json() as Promise<OAuthClient>;
}

// Provision (idempotently) a client record and its redirect URIs. Used by explicit
// Dynamic Client Registration and by implicit registration at the authorize endpoint.
// Clients are public (token_endpoint_auth_method=none) and PKCE-protected, and DCR is
// open, so provisioning an as-yet-unseen client_id adds no privilege. Persisted by backend.
async function provisionClient(
  env: AuthorizeEnv,
  clientId: string,
  clientName: string,
  redirectUris: string[],
): Promise<void> {
  const res = await oauthDbFetch(env, "POST", "/api/v1/identity/oauth/clients", {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
  });
  if (!res.ok) throw new Error("provision_failed");
}

// Mint + persist an authorization code (backend owns the code value and TTL). Returns the
// code on success, or null if persistence failed.
async function createAuthCode(
  env: AuthorizeEnv,
  input: { userId: string; groupId: string; params: McpOAuthParams },
): Promise<string | null> {
  const res = await oauthDbFetch(env, "POST", "/api/v1/identity/oauth/authorization-codes", {
    client_id: input.params.client_id,
    user_id: input.userId,
    group_id: input.groupId,
    scopes: input.params.scope,
    code_challenge: input.params.code_challenge,
    code_challenge_method: input.params.code_challenge_method,
    redirect_uri: input.params.redirect_uri,
    resource: input.params.resource,
  });
  if (!res.ok) return null;
  const { code } = await res.json() as { code: string };
  return code;
}

// GET /.well-known/oauth-authorization-server
export function handleOAuthMetadata(request: Request, env: AuthorizeEnv): Response {
  const base = origin(request, env);
  return Response.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/mcp/authorize`,
    token_endpoint: `${base}/oauth/mcp/token`,
    registration_endpoint: `${base}/oauth/mcp/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["graph:read", "graph:write"],
  });
}

// GET /.well-known/openid-configuration  (OIDC Discovery)
// This origin is an OpenID Provider: the OAuth endpoints above plus JWKS and id_token.
export function handleOpenIDConfiguration(request: Request, env: AuthorizeEnv): Response {
  const base = origin(request, env);
  return Response.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/mcp/authorize`,
    token_endpoint: `${base}/oauth/mcp/token`,
    registration_endpoint: `${base}/oauth/mcp/register`,
    jwks_uri: `${base}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["ES256"],
    scopes_supported: ["openid", "graph:read", "graph:write"],
    claims_supported: ["iss", "sub", "aud", "exp", "iat", "auth_time", "group_id"],
  });
}

// GET /.well-known/jwks.json  — public signing key so clients can verify id_tokens.
export async function handleJwks(request: Request, env: AuthorizeEnv): Promise<Response> {
  const jwk = await getPublicJwk(env);
  return Response.json({ keys: jwk ? [jwk] : [] });
}

// POST /oauth/mcp/register  (RFC 7591 Dynamic Client Registration)
export async function handleMcpRegister(request: Request, env: AuthorizeEnv): Promise<Response> {
  const body = await request.json() as {
    client_name?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
  };

  const clientId = crypto.randomUUID();
  const clientName = body.client_name ?? "MCP Client";
  const redirectUris = body.redirect_uris ?? [];

  try {
    await provisionClient(env, clientId, clientName, redirectUris);
  } catch {
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  return Response.json({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }, { status: 201 });
}

// GET /oauth/mcp/authorize
export async function handleMcpAuthorize(request: Request, env: AuthorizeEnv): Promise<Response> {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "S256";
  const state = url.searchParams.get("state") ?? "";
  const scope = url.searchParams.get("scope") ?? "graph:read graph:write";
  // RFC 8707: the resource the client wants a token for. We only serve one resource
  // (this MCP server), so reject a mismatched request and default to it when omitted.
  const serverResource = mcpResource(request, env);
  const requestedResource = url.searchParams.get("resource");
  if (requestedResource && requestedResource !== serverResource) {
    return new Response("Unsupported resource", { status: 400 });
  }
  const resource = serverResource;

  if (!redirectUri || !codeChallenge || !state) {
    return new Response("Missing required parameters", { status: 400 });
  }
  if (codeChallengeMethod !== "S256") {
    return new Response("Only S256 code_challenge_method is supported", { status: 400 });
  }

  let client = await lookupClient(env, clientId);
  if (!client && clientId && redirectUri) {
    // Implicit registration: a public PKCE client presenting an as-yet-unseen client_id
    // (e.g. one it cached from a prior session) is provisioned on the fly with the
    // redirect_uri it presents, then the flow continues. Lets such clients recover
    // without a separate registration round-trip.
    await provisionClient(env, clientId, "MCP Client", [redirectUri]);
    client = await lookupClient(env, clientId);
  }
  if (!client) return new Response("Unknown client_id", { status: 400 });

  const allowedUris: string[] = client.redirect_uris;
  if (allowedUris.length > 0 && !allowedUris.includes(redirectUri)) {
    return new Response("Invalid redirect_uri", { status: 400 });
  }

  const params: McpOAuthParams = { client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod, state, scope, resource };
  const paramsCookie = serializeCookie(MCP_OAUTH_PARAMS_COOKIE, btoa(JSON.stringify(params)), {
    maxAge: CODE_TTL,
    path: "/",
    secure: isSecure(request),
    httpOnly: true,
    sameSite: "Lax",
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Authorize Claude Code</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 16px; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    p { color: #555; margin-bottom: 24px; }
    .scope { background: #f3f4f6; padding: 8px 12px; border-radius: 6px; font-size: .875rem; margin-bottom: 24px; }
    a.btn { display: block; text-align: center; padding: 12px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-bottom: 12px; }
    .github { background: #24292e; color: #fff; }
    .google { background: #4285f4; color: #fff; }
  </style>
</head>
<body>
  <h1>Authorize ${client.name ?? ""}</h1>
  <p>Sign in to grant access to your graph data.</p>
  <div class="scope">Scopes: ${scope}</div>
  <a class="btn github" href="/oauth/github/start">Sign in with GitHub</a>
  <a class="btn google" href="/oauth/google/start">Sign in with Google</a>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": paramsCookie },
  });
}

// GET /oauth/mcp/select-org
export async function handleMcpSelectOrg(request: Request, env: AuthorizeEnv): Promise<Response> {
  const cookies = parseCookies(request);
  const userId = (await readIdentity(env, request))?.userId;
  const paramsRaw = cookies.get(MCP_OAUTH_PARAMS_COOKIE);
  if (!userId || !paramsRaw) {
    return new Response("Session expired. Please restart the authorization flow.", { status: 400 });
  }

  let params: McpOAuthParams;
  try {
    params = JSON.parse(atob(paramsRaw)) as McpOAuthParams;
  } catch {
    return new Response("Invalid session.", { status: 400 });
  }

  // 名前は group DB を正とする（identity は id のみ返す）。listUserOrganizations が group DB から解決する。
  const organizations = await listUserOrganizations(env, userId).catch(() => [] as { id: string; name: string }[]);

  const options = organizations.map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join("");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Select Organization</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 16px; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    p { color: #555; margin-bottom: 16px; }
    select { width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem; margin-bottom: 16px; }
    .scope { background: #f3f4f6; padding: 8px 12px; border-radius: 6px; font-size: .875rem; margin-bottom: 20px; }
    button { width: 100%; padding: 12px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    label { display: block; font-size: .875rem; font-weight: 600; margin-bottom: 6px; }
    input[type=text] { width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem; margin-bottom: 12px; box-sizing: border-box; }
    .create-btn { background: #059669; }
    h2 { font-size: 1.1rem; margin-bottom: 8px; }
  </style>
</head>
<body>
  <h1>Select Organization</h1>
  <p>Grant access to one of your organizations.</p>
  <div class="scope">Scopes: ${params.scope}</div>
  ${organizations.length > 0
    ? `<form method="POST" action="/oauth/mcp/approve">
         <select name="group_id" required>${options}</select>
         <button type="submit">Authorize</button>
       </form>
       <hr>`
    : ""}
  <h2>${organizations.length === 0 ? "Create an Organization" : "Or create a new organization"}</h2>
  <form method="POST" action="/oauth/mcp/create-org">
    <label for="org_name">Organization name</label>
    <input type="text" id="org_name" name="org_name" required placeholder="My Organization">
    <button type="submit" class="create-btn">Create &amp; Authorize</button>
  </form>
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// POST /oauth/mcp/approve
export async function handleMcpApprove(request: Request, env: AuthorizeEnv): Promise<Response> {
  const cookies = parseCookies(request);
  const userId = (await readIdentity(env, request))?.userId;
  const paramsRaw = cookies.get(MCP_OAUTH_PARAMS_COOKIE);
  if (!userId || !paramsRaw) {
    return new Response("Session expired.", { status: 400 });
  }

  let params: McpOAuthParams;
  try {
    params = JSON.parse(atob(paramsRaw)) as McpOAuthParams;
  } catch {
    return new Response("Invalid session.", { status: 400 });
  }

  const formData = await request.formData();
  const groupId = formData.get("group_id") as string | null;
  if (!groupId) return new Response("group_id required", { status: 400 });

  const code = await createAuthCode(env, { userId, groupId, params });
  if (!code) return new Response("Failed to persist authorization code", { status: 502 });

  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie(MCP_OAUTH_PARAMS_COOKIE, request));
  for (const c of identityClearCookies()) headers.append("Set-Cookie", c);

  const redirectUrl = new URL(params.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  redirectUrl.searchParams.set("state", params.state);
  headers.set("Location", redirectUrl.toString());
  return new Response(null, { status: 302, headers });
}

// POST /oauth/mcp/create-org
export async function handleMcpCreateOrg(request: Request, env: AuthorizeEnv): Promise<Response> {
  const cookies = parseCookies(request);
  const userId = (await readIdentity(env, request))?.userId;
  const paramsRaw = cookies.get(MCP_OAUTH_PARAMS_COOKIE);
  if (!userId || !paramsRaw) {
    return new Response("Session expired. Please restart the authorization flow.", { status: 400 });
  }

  let params: McpOAuthParams;
  try {
    params = JSON.parse(atob(paramsRaw)) as McpOAuthParams;
  } catch {
    return new Response("Invalid session.", { status: 400 });
  }

  const formData = await request.formData();
  const orgName = (formData.get("org_name") as string | null)?.trim();
  if (!orgName) return new Response("org_name required", { status: 400 });

  let org: { id: string };
  try {
    org = await createOrganization(env, userId, orgName);
  } catch (e) {
    return new Response(`Failed to create organization: ${String(e)}`, { status: 500 });
  }

  const code = await createAuthCode(env, { userId, groupId: org.id, params });
  if (!code) return new Response("Failed to persist authorization code", { status: 502 });

  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie(MCP_OAUTH_PARAMS_COOKIE, request));
  for (const c of identityClearCookies()) headers.append("Set-Cookie", c);

  const redirectUrl = new URL(params.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  redirectUrl.searchParams.set("state", params.state);
  headers.set("Location", redirectUrl.toString());
  return new Response(null, { status: 302, headers });
}

const ACCESS_TTL = 300;                 // access token: 5 minutes (short-lived)
const REFRESH_TTL = 60 * 60 * 24 * 90;  // refresh token: 90 days

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Resolve the scopes actually granted to this client's agent (intersect requested with the
// agent's allowed scopes) and its provider. Best-effort: falls back to the requested scopes.
async function resolveEffectiveScopes(
  env: AuthorizeEnv,
  clientId: string,
  groupId: string,
  requestedScopes: string[],
): Promise<{ scopes: string[]; provider?: string }> {
  let scopes = requestedScopes;
  let provider: string | undefined;
  try {
    const agentRes = await authorizeFetch(env, {
      path: "/api/v1/agent/by-client-id?client_id=" + encodeURIComponent(clientId),
      method: "GET",
      actorType: "program",
      tenantContext: { tenantId: groupId },
    });
    if (agentRes.ok) {
      const agentData = await agentRes.json() as { provider?: string; scopes?: string[] };
      if (agentData.provider) provider = agentData.provider;
      if (Array.isArray(agentData.scopes)) {
        const allowed = new Set(agentData.scopes);
        scopes = requestedScopes.filter(s => allowed.has(s));
      }
    }
  } catch {
    // best-effort: fall back to requestedScopes with no provider
  }
  return { scopes, provider };
}

// Issue a short-lived access token + a fresh rotating refresh token, and build the
// token endpoint response. Only the SHA-256 hash of the refresh token is stored.
// 安定なエージェント口座 id を (認可ユーザー, client_name) から決定的に導く。client_id は DCR 登録ごとに
// 変わる揮発値なので識別子には使わない。client_name はクライアントが RFC 7591 登録で名乗る種類名
// （例 "Claude Code (front-dev)"）。取得できない場合は "MCP Client" にフォールバック。
async function resolveAgentId(env: AuthorizeEnv, userId: string, clientId: string): Promise<string> {
  const client = await lookupClient(env, clientId).catch(() => null);
  const clientName = client?.name || "MCP Client";
  return sha256Hex(`${userId}|${clientName}`);
}

async function issueTokenResponse(
  env: AuthorizeEnv,
  input: { clientId: string; userId: string; groupId: string; scopes: string[]; provider?: string; resource: string },
): Promise<Response> {
  const agentId = await resolveAgentId(env, input.userId, input.clientId);
  const accessToken = await issueMcpToken(env, {
    groupId: input.groupId,
    userId: input.userId,
    scopes: input.scopes,
    agentId,
    provider: input.provider,
    audience: input.resource,
  });
  const refreshToken = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Math.floor(Date.now() / 1000);
  const stored = await oauthDbFetch(env, "POST", "/api/v1/identity/oauth/refresh-tokens", {
    token_hash: await sha256Hex(refreshToken),
    client_id: input.clientId,
    user_id: input.userId,
    group_id: input.groupId,
    scopes: input.scopes.join(" "),
    provider: input.provider ?? null,
    expires_at: now + REFRESH_TTL,
    resource: input.resource,
  });
  if (!stored.ok) return Response.json({ error: "server_error" }, { status: 502 });
  const body: Record<string, unknown> = {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: ACCESS_TTL,
    refresh_token: refreshToken,
    scope: input.scopes.join(" "),
  };
  // OIDC: return an id_token only when the client asked for the openid scope. Existing
  // MCP clients request graph:* scopes (no openid) and are unaffected.
  if (input.scopes.includes("openid")) {
    body.id_token = await issueIdToken(env, { clientId: input.clientId, userId: input.userId, groupId: input.groupId });
  }
  return Response.json(body);
}

// POST /oauth/mcp/token
export async function handleMcpToken(request: Request, env: AuthorizeEnv): Promise<Response> {
  let params: URLSearchParams;
  const ct = request.headers.get("Content-Type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await request.text());
  } else {
    const body = (await request.json()) as Record<string, string>;
    params = new URLSearchParams(body);
  }

  const grantType = params.get("grant_type");
  const clientId = params.get("client_id");
  if (!clientId) return Response.json({ error: "invalid_request" }, { status: 400 });

  // grant_type=refresh_token — rotate the refresh token and mint a new access token.
  if (grantType === "refresh_token") {
    const refreshToken = params.get("refresh_token");
    if (!refreshToken) return Response.json({ error: "invalid_request" }, { status: 400 });
    const client = await lookupClient(env, clientId);
    if (!client) return Response.json({ error: "invalid_client" }, { status: 400 });
    const consume = await oauthDbFetch(env, "POST", "/api/v1/identity/oauth/refresh-tokens/consume", {
      token_hash: await sha256Hex(refreshToken),
      client_id: clientId,
    });
    if (!consume.ok) return Response.json(await consume.json(), { status: consume.status });
    const rt = await consume.json() as { user_id: string; group_id: string; scopes: string; provider: string | null; resource: string | null };
    const { scopes, provider } = await resolveEffectiveScopes(env, clientId, rt.group_id, rt.scopes.split(" ").filter(Boolean));
    return issueTokenResponse(env, { clientId, userId: rt.user_id, groupId: rt.group_id, scopes, provider, resource: rt.resource ?? mcpResource(request, env) });
  }

  // grant_type=authorization_code
  const code = params.get("code");
  const codeVerifier = params.get("code_verifier");
  const redirectUri = params.get("redirect_uri");
  if (grantType !== "authorization_code" || !code || !codeVerifier || !redirectUri) {
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  const client = await lookupClient(env, clientId);
  if (!client) return Response.json({ error: "invalid_client" }, { status: 400 });

  // Backend validates the code (existence, single-use, expiry, redirect_uri, client, PKCE) and
  // marks it used, returning the grant context.
  const consume = await oauthDbFetch(env, "POST", "/api/v1/identity/oauth/authorization-codes/consume", {
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  if (!consume.ok) return Response.json(await consume.json(), { status: consume.status });
  const row = await consume.json() as { user_id: string; group_id: string; scopes: string; resource: string | null };

  const { scopes, provider } = await resolveEffectiveScopes(env, clientId, row.group_id, row.scopes.split(" ").filter(Boolean));
  return issueTokenResponse(env, { clientId, userId: row.user_id, groupId: row.group_id, scopes, provider, resource: row.resource ?? mcpResource(request, env) });
}
