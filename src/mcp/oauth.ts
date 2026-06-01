import type { AuthorizeEnv } from "../auth";
import { parseCookies, serializeCookie, clearCookie } from "../auth/cookies";
import { issueMcpToken } from "../auth/token";
import { authorizeFetch } from "../auth/fetch";
import { IDENTITY_USER_ID_COOKIE, MCP_OAUTH_PARAMS_COOKIE } from "../auth/github";

const CODE_TTL = 60 * 10; // 10 minutes
const ALLOWED_CLIENTS = ["claude-mcp"];

type McpOAuthParams = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  scope: string;
};

function toBase64Url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function origin(request: Request, env: AuthorizeEnv): string {
  return env.FRONTEND_ORIGIN ?? new URL(request.url).origin;
}

// GET /.well-known/oauth-authorization-server
export function handleOAuthMetadata(request: Request, env: AuthorizeEnv): Response {
  const base = origin(request, env);
  return Response.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/mcp/authorize`,
    token_endpoint: `${base}/oauth/mcp/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["graph:read", "graph:write"],
  });
}

// GET /oauth/mcp/authorize
export function handleMcpAuthorize(request: Request, env: AuthorizeEnv): Response {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "S256";
  const state = url.searchParams.get("state") ?? "";
  const scope = url.searchParams.get("scope") ?? "graph:read graph:write";

  if (!ALLOWED_CLIENTS.includes(clientId)) {
    return new Response("Unknown client_id", { status: 400 });
  }
  if (!redirectUri || !codeChallenge || !state) {
    return new Response("Missing required parameters", { status: 400 });
  }
  if (codeChallengeMethod !== "S256") {
    return new Response("Only S256 code_challenge_method is supported", { status: 400 });
  }

  const params: McpOAuthParams = { client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod, state, scope };
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
  <h1>Authorize Claude Code</h1>
  <p>Claude Code is requesting access to your graph data. Sign in to continue.</p>
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
  const userId = cookies.get(IDENTITY_USER_ID_COOKIE);
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

  const orgsRes = await authorizeFetch(env, {
    path: `/api/v1/identity/organizations?user_id=${encodeURIComponent(userId)}`,
    method: "GET",
  });
  const { organizations = [] } = orgsRes.ok
    ? (await orgsRes.json() as { organizations: { id: string; name: string }[] })
    : { organizations: [] };

  const options = organizations.map((o) => `<option value="${o.id}">${o.name}</option>`).join("");
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
    .empty { color: #ef4444; }
  </style>
</head>
<body>
  <h1>Select Organization</h1>
  <p>Grant Claude Code access to one of your organizations.</p>
  <div class="scope">Scopes: ${params.scope}</div>
  ${organizations.length === 0
    ? '<p class="empty">No organizations found. Create an organization first.</p>'
    : `<form method="POST" action="/oauth/mcp/approve">
         <select name="org_id" required>${options}</select>
         <button type="submit">Authorize</button>
       </form>`}
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// POST /oauth/mcp/approve
export async function handleMcpApprove(request: Request, env: AuthorizeEnv): Promise<Response> {
  if (!env.IDENTITY_DB) return new Response("IDENTITY_DB not configured", { status: 503 });

  const cookies = parseCookies(request);
  const userId = cookies.get(IDENTITY_USER_ID_COOKIE);
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
  const orgId = formData.get("org_id") as string | null;
  if (!orgId) return new Response("org_id required", { status: 400 });

  const code = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + CODE_TTL;

  await env.IDENTITY_DB.prepare(`
    INSERT INTO m_oauth_authorization_codes
      (code, client_id, user_id, org_id, scopes, code_challenge, code_challenge_method, redirect_uri, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(code, params.client_id, userId, orgId, params.scope, params.code_challenge, params.code_challenge_method, params.redirect_uri, expiresAt).run();

  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie(MCP_OAUTH_PARAMS_COOKIE, request));
  headers.append("Set-Cookie", clearCookie(IDENTITY_USER_ID_COOKIE, request));

  const redirectUrl = new URL(params.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  redirectUrl.searchParams.set("state", params.state);
  headers.set("Location", redirectUrl.toString());
  return new Response(null, { status: 302, headers });
}

// POST /oauth/mcp/token
export async function handleMcpToken(request: Request, env: AuthorizeEnv): Promise<Response> {
  if (!env.IDENTITY_DB) return Response.json({ error: "server_error" }, { status: 500 });

  let params: URLSearchParams;
  const ct = request.headers.get("Content-Type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await request.text());
  } else {
    const body = (await request.json()) as Record<string, string>;
    params = new URLSearchParams(body);
  }

  const grantType = params.get("grant_type");
  const code = params.get("code");
  const codeVerifier = params.get("code_verifier");
  const redirectUri = params.get("redirect_uri");
  const clientId = params.get("client_id");

  if (grantType !== "authorization_code" || !code || !codeVerifier || !redirectUri || !clientId) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const row = await env.IDENTITY_DB.prepare(`
    SELECT code, client_id, user_id, org_id, scopes, code_challenge, code_challenge_method, redirect_uri, expires_at, used
    FROM m_oauth_authorization_codes WHERE code = ?
  `).bind(code).first<{
    code: string; client_id: string; user_id: string; org_id: string; scopes: string;
    code_challenge: string; code_challenge_method: string; redirect_uri: string;
    expires_at: number; used: number;
  }>();

  if (!row) return Response.json({ error: "invalid_grant" }, { status: 400 });
  if (row.used) return Response.json({ error: "invalid_grant", error_description: "Code already used" }, { status: 400 });
  if (row.expires_at < Math.floor(Date.now() / 1000)) return Response.json({ error: "invalid_grant", error_description: "Code expired" }, { status: 400 });
  if (row.redirect_uri !== redirectUri) return Response.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, { status: 400 });
  if (row.client_id !== clientId) return Response.json({ error: "invalid_client" }, { status: 400 });

  // PKCE validation
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const computed = toBase64Url(new Uint8Array(hash));
  if (computed !== row.code_challenge) {
    return Response.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, { status: 400 });
  }

  await env.IDENTITY_DB.prepare("UPDATE m_oauth_authorization_codes SET used = 1 WHERE code = ?").bind(code).run();

  const scopes = row.scopes.split(" ").filter(Boolean);
  const accessToken = await issueMcpToken(env, {
    orgId: row.org_id,
    userId: row.user_id,
    scopes,
    clientId: row.client_id,
  });

  return Response.json({
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 28800,
    scope: row.scopes,
  });
}
