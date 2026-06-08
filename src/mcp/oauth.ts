import type { D1Database } from "@cloudflare/workers-types";
import type { AuthorizeEnv } from "../auth";
import { parseCookies, serializeCookie, clearCookie } from "../auth/cookies";
import { issueMcpToken } from "../auth/token";
import { authorizeFetch } from "../auth/fetch";
import { IDENTITY_USER_ID_COOKIE, MCP_OAUTH_PARAMS_COOKIE } from "../auth/github";
import { createOrganization } from "../identify";

const CODE_TTL = 60 * 10; // 10 minutes

type McpOAuthParams = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  scope: string;
};

type DbClient = {
  id: string;
  name: string | null;
  redirect_uris: string; // JSON array string from json_group_array
};

function toBase64Url(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

async function hmacHex(keyHex: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", hexToBytes(keyHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function resolveSecret(value: string | { get(): Promise<string> } | undefined): Promise<string | undefined> {
  if (value && typeof value !== "string") return value.get();
  return value;
}

function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function origin(request: Request, env: AuthorizeEnv): string {
  return env.FRONTEND_ORIGIN ?? new URL(request.url).origin;
}

async function lookupClient(db: D1Database, clientId: string): Promise<DbClient | null> {
  return db.prepare(`
    SELECT
      c.id,
      cn.value AS name,
      COALESCE(json_group_array(r.value) FILTER (WHERE r.value IS NOT NULL), '[]') AS redirect_uris
    FROM m_client c
    LEFT JOIN j_client_name jcn ON jcn.client_id = c.id
    LEFT JOIN m_client_name cn ON cn.id = jcn.name_id
    LEFT JOIN j_client_redirect jcr ON jcr.client_id = c.id
    LEFT JOIN m_redirect r ON r.id = jcr.redirect_uri_id
    WHERE c.id = ?
    GROUP BY c.id
  `).bind(clientId).first<DbClient>();
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
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["graph:read", "graph:write"],
  });
}

// POST /oauth/mcp/register  (RFC 7591 Dynamic Client Registration)
export async function handleMcpRegister(request: Request, env: AuthorizeEnv): Promise<Response> {
  if (!env.IDENTITY_DB) return Response.json({ error: "server_error" }, { status: 500 });

  const body = await request.json() as {
    client_name?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
  };

  const clientId = crypto.randomUUID();
  const clientName = body.client_name ?? "Unknown Client";
  const nameId = crypto.randomUUID();
  const redirectUris = body.redirect_uris ?? [];

  const hmacKey = await resolveSecret(env.IDENTITY_HMAC_KEY);
  if (!hmacKey) return Response.json({ error: "server_error" }, { status: 500 });
  const aiHash = await hmacHex(hmacKey, "ai");
  const actorRow = await env.IDENTITY_DB.prepare("SELECT id FROM m_actor WHERE value_hash = ?")
    .bind(aiHash).first<{ id: string }>();
  if (!actorRow) return Response.json({ error: "server_error" }, { status: 500 });

  await env.IDENTITY_DB.batch([
    env.IDENTITY_DB.prepare("INSERT INTO m_client (id) VALUES (?)").bind(clientId),
    env.IDENTITY_DB.prepare("INSERT INTO m_client_name (id, value) VALUES (?, ?)").bind(nameId, clientName),
    env.IDENTITY_DB.prepare("INSERT INTO j_client_name (client_id, name_id) VALUES (?, ?)").bind(clientId, nameId),
    env.IDENTITY_DB.prepare("INSERT INTO j_client_actor (client_id, actor_id) VALUES (?, ?)").bind(clientId, actorRow.id),
  ]);

  if (redirectUris.length > 0) {
    await env.IDENTITY_DB.batch(
      redirectUris.map(uri =>
        env.IDENTITY_DB.prepare("INSERT OR IGNORE INTO m_redirect (id, value) VALUES (?, ?)").bind(crypto.randomUUID(), uri)
      )
    );

    const placeholders = redirectUris.map(() => "?").join(", ");
    const uriRows = await env.IDENTITY_DB.prepare(
      `SELECT id, value FROM m_redirect WHERE value IN (${placeholders})`
    ).bind(...redirectUris).all<{ id: string; value: string }>();

    const uriIdMap = new Map(uriRows.results.map(r => [r.value, r.id]));
    await env.IDENTITY_DB.batch(
      redirectUris
        .filter(uri => uriIdMap.has(uri))
        .map(uri =>
          env.IDENTITY_DB.prepare("INSERT OR IGNORE INTO j_client_redirect (client_id, redirect_uri_id) VALUES (?, ?)").bind(clientId, uriIdMap.get(uri))
        )
    );
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
  if (!env.IDENTITY_DB) return new Response("IDENTITY_DB not configured", { status: 503 });

  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "S256";
  const state = url.searchParams.get("state") ?? "";
  const scope = url.searchParams.get("scope") ?? "graph:read graph:write";

  if (!redirectUri || !codeChallenge || !state) {
    return new Response("Missing required parameters", { status: 400 });
  }
  if (codeChallengeMethod !== "S256") {
    return new Response("Only S256 code_challenge_method is supported", { status: 400 });
  }

  const client = await lookupClient(env.IDENTITY_DB, clientId);
  if (!client) return new Response("Unknown client_id", { status: 400 });

  const allowedUris: string[] = JSON.parse(client.redirect_uris);
  if (allowedUris.length > 0 && !allowedUris.includes(redirectUri)) {
    return new Response("Invalid redirect_uri", { status: 400 });
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
         <select name="org_id" required>${options}</select>
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
  const groupId = formData.get("org_id") as string | null;
  if (!groupId) return new Response("org_id required", { status: 400 });

  const code = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + CODE_TTL;

  await env.IDENTITY_DB.prepare(`
    INSERT INTO t_oauth_authorization_code
      (code, client_id, user_id, group_id, scopes, code_challenge, code_challenge_method, redirect_uri, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(code, params.client_id, userId, groupId, params.scope, params.code_challenge, params.code_challenge_method, params.redirect_uri, expiresAt).run();

  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie(MCP_OAUTH_PARAMS_COOKIE, request));
  headers.append("Set-Cookie", clearCookie(IDENTITY_USER_ID_COOKIE, request));

  const redirectUrl = new URL(params.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  redirectUrl.searchParams.set("state", params.state);
  headers.set("Location", redirectUrl.toString());
  return new Response(null, { status: 302, headers });
}

// POST /oauth/mcp/create-org
export async function handleMcpCreateOrg(request: Request, env: AuthorizeEnv): Promise<Response> {
  if (!env.IDENTITY_DB) return new Response("IDENTITY_DB not configured", { status: 503 });

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

  const formData = await request.formData();
  const orgName = (formData.get("org_name") as string | null)?.trim();
  if (!orgName) return new Response("org_name required", { status: 400 });

  let org: { id: string };
  try {
    org = await createOrganization(env, userId, orgName);
  } catch (e) {
    return new Response(`Failed to create organization: ${String(e)}`, { status: 500 });
  }

  const code = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + CODE_TTL;

  await env.IDENTITY_DB.prepare(`
    INSERT INTO t_oauth_authorization_code
      (code, client_id, user_id, group_id, scopes, code_challenge, code_challenge_method, redirect_uri, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(code, params.client_id, userId, org.id, params.scope, params.code_challenge, params.code_challenge_method, params.redirect_uri, expiresAt).run();

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

  const client = await lookupClient(env.IDENTITY_DB, clientId);
  if (!client) return Response.json({ error: "invalid_client" }, { status: 400 });

  const row = await env.IDENTITY_DB.prepare(`
    SELECT code, client_id, user_id, group_id, scopes, code_challenge, code_challenge_method, redirect_uri, expires_at, used
    FROM t_oauth_authorization_code WHERE code = ?
  `).bind(code).first<{
    code: string; client_id: string; user_id: string; group_id: string; scopes: string;
    code_challenge: string; code_challenge_method: string; redirect_uri: string;
    expires_at: number; used: number;
  }>();

  if (!row) return Response.json({ error: "invalid_grant" }, { status: 400 });
  if (row.used) return Response.json({ error: "invalid_grant", error_description: "Code already used" }, { status: 400 });
  if (row.expires_at < Math.floor(Date.now() / 1000)) return Response.json({ error: "invalid_grant", error_description: "Code expired" }, { status: 400 });
  if (row.redirect_uri !== redirectUri) return Response.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, { status: 400 });
  if (row.client_id !== clientId) return Response.json({ error: "invalid_client" }, { status: 400 });

  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const computed = toBase64Url(new Uint8Array(hash));
  if (computed !== row.code_challenge) {
    return Response.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, { status: 400 });
  }

  await env.IDENTITY_DB.prepare("UPDATE t_oauth_authorization_code SET used = 1 WHERE code = ?").bind(code).run();

  const scopes = row.scopes.split(" ").filter(Boolean);
  const accessToken = await issueMcpToken(env, {
    orgId: row.group_id,
    userId: row.user_id,
    scopes,
    clientId: row.client_id,
  });

  return Response.json({
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 7776000,
    scope: row.scopes,
  });
}
