import { CLIENT_JS_PATH } from './client-path';
import {
  handleGitHubOAuthCallback,
  handleGitHubOAuthStart,
  handleGitHubConnectStart,
  handleGitHubConnectCallback,
} from './session/github';
import { handleGoogleLoginStart, handleGoogleLoginCallback } from './session/google';
import { handleMicrosoftLoginStart, handleMicrosoftLoginCallback } from './session/microsoft';
import type { AuthorizeEnv } from './session';
import { readIdentity, identityClearCookies } from './session/identity';
import { handleApiRequest as handleDataApiRequest, handleGitHubAuthStatus, handleAuthStatus, handleIdentityStatus, handleOrgCreate, handleOrgRename, handleSelectOrg, handleOrgMembers, handleAutoSelectOrg, handleMagicLinkRequest, handleMagicLinkVerify, handleMemberCheck, handleGroupLoginPage, handleOrgSlugLogin, handleOrgGroupsApi, handleOrgGroupSelectPage } from './routes/data';
import { handleApiRequest as handleLayoutApiRequest } from './routes/layout';
import { handleMcp } from './mcp/handler';
import {
  handleOAuthMetadata,
  handleOpenIDConfiguration,
  handleJwks,
  handleMcpRegister,
  handleMcpAuthorize,
  handleMcpSelectOrg,
  handleMcpApprove,
  handleMcpCreateOrg,
  handleMcpToken,
} from './mcp/oauth';
import { clearGitHubSessionCookies, clearGitHubConnectSessionCookies, clearGoogleSessionCookies, clearMicrosoftSessionCookies, clearOidcSessionCookies } from './identify';
import { handleOidcLoginStart, handleOidcLoginCallback } from './session/oidc';
import { handleSamlMetadata, handleSamlSsoStart, handleSamlAcs } from './session/saml';
import { authorizeFetch } from './session/fetch';

type AssetsEnv = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  readonly LAYOUTS?: {
    list(options: { prefix: string; cursor?: string }): Promise<{
      objects: { key: string }[];
      truncated: boolean;
      cursor: string;
    }>;
    get(key: string): Promise<{ text(): Promise<string> } | null>;
    put(
      key: string,
      value: string,
      options?: {
        httpMetadata?: {
          contentType?: string;
        };
      },
    ): Promise<unknown>;
    delete(keys: string | string[]): Promise<unknown>;
  };
  readonly LAYOUTS_BUCKET_ID?: string;
};

type Env = AssetsEnv & AuthorizeEnv;

const getNavCookies = async (
  request: Request,
  env: AuthorizeEnv,
): Promise<{ userId: string | null; orgId: string | null }> => {
  const identity = await readIdentity(env, request);
  return { userId: identity?.userId ?? null, orgId: identity?.groupId ?? null };
};

const isPublicPath = (pathname: string): boolean =>
  pathname === '/login' ||
  pathname === '/public' ||
  /^\/login\/[0-9a-f-]{36}$/i.test(pathname) ||
  /^\/login\/[a-z0-9][a-z0-9-]*[a-z0-9]$/i.test(pathname) ||
  pathname === '/org-group-select' ||
  pathname === '/auth/magic' ||
  pathname === '/api/v1/auth/member-check' ||
  pathname === '/api/v1/auth/org-groups' ||
  /^\/auth\/saml\/[^/]+\/(metadata|sso|acs)$/.test(pathname) ||
  pathname.startsWith('/oauth/') ||
  pathname.startsWith('/github/oauth/') ||
  pathname.startsWith('/.well-known/') ||
  pathname.startsWith('/mcp') ||
  pathname.startsWith('/api/');

const isNavigationRequest = (request: Request): boolean => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('text/html');
};

// Public test surface: reachable without login (outside the auth gate). Renders
// the visitor's 立場 (stance) derived purely from identity cookies — a person's
// org-relative standing, distinct from the subject model:
//   guest   (ゲスト)   : not logged in
//   visitor (ビジター) : logged in, no group context (non-member)
//   member  (メンバー) : logged in and in a group
// Only "present / absent" of the cookies is shown, never their values (no XSS).
const renderPublicStancePage = async (request: Request, env: AuthorizeEnv): Promise<Response> => {
  const { userId, orgId } = await getNavCookies(request, env);
  const [stanceJa, stanceEn, desc] = !userId
    ? ['ゲスト', 'guest', '未ログイン。認証なしでこの公開ページに到達できています（認証ゲートの外側）。']
    : !orgId
      ? ['ビジター', 'visitor', 'ログイン済みですが、グループ未選択＝このグループの非メンバーです。']
      : ['メンバー', 'member', 'ログイン済み、かつグループのメンバーです。'];
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Public — Tempri</title>
<style>
  body{margin:0;background:#0e1626;color:#e6edf6;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{background:#16213a;border:1px solid #243049;border-radius:14px;padding:32px 40px;max-width:520px;width:90%}
  .badge{display:inline-block;font-size:12px;color:#8aa0c0;border:1px solid #2c3a57;border-radius:999px;padding:2px 10px;margin-bottom:14px}
  h1{margin:0 0 4px;font-size:18px}
  .sub{color:#8aa0c0;font-size:13px;margin-bottom:22px}
  .stance{font-size:32px;font-weight:700;margin:8px 0}
  .stance span{font-size:16px;color:#8aa0c0;font-weight:400}
  .desc{color:#c2cfe2;line-height:1.7;font-size:14px}
  .meta{margin-top:20px;font-size:12px;color:#6f86a8}
  a{color:#6ea8ff}
</style></head>
<body><div class="card">
  <span class="badge">public surface · no login required</span>
  <h1>あなたの立場</h1>
  <div class="sub">認証ゲートの外側にある公開テストページです</div>
  <div class="stance">${stanceJa} <span>/ ${stanceEn}</span></div>
  <div class="desc">${desc}</div>
  <div class="meta">identity_user_id: ${userId ? 'あり' : 'なし'} ／ identity_group_id: ${orgId ? 'あり' : 'なし'}<br><a href="/login">ログイン</a></div>
</div></body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
};

async function handleAdminOidcApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // POST /api/v1/auth/admin/oidc — create provider
  if (pathname === '/api/v1/auth/admin/oidc' && request.method === 'POST') {
    const body = await request.json();
    const res = await authorizeFetch(env, {
      path: '/api/v1/identity/oidc',
      method: 'POST',
      body: JSON.stringify(body),
    });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }

  // PUT /api/v1/auth/admin/oidc/:oidcId — update provider
  const oidcPutMatch = pathname.match(/^\/api\/v1\/auth\/admin\/oidc\/([^/]+)$/);
  if (oidcPutMatch && request.method === 'PUT') {
    const oidcId = decodeURIComponent(oidcPutMatch[1]);
    const body = await request.json();
    const res = await authorizeFetch(env, {
      path: `/api/v1/identity/oidc/${encodeURIComponent(oidcId)}`,
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }

  // DELETE /api/v1/auth/admin/oidc/:oidcId — delete provider
  if (oidcPutMatch && request.method === 'DELETE') {
    const oidcId = decodeURIComponent(oidcPutMatch[1]);
    const res = await authorizeFetch(env, {
      path: `/api/v1/identity/oidc/${encodeURIComponent(oidcId)}`,
      method: 'DELETE',
    });
    return new Response(null, { status: res.status });
  }

  // GET /api/v1/auth/admin/login-policy?group_id=
  if (pathname === '/api/v1/auth/admin/login-policy' && request.method === 'GET') {
    const groupId = url.searchParams.get('group_id');
    if (!groupId) return new Response(JSON.stringify({ error: 'group_id_required' }), { status: 400 });
    const res = await authorizeFetch(env, {
      path: `/api/v1/identity/groups/${encodeURIComponent(groupId)}/login-policy`,
      method: 'GET',
    });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }

  // PUT /api/v1/auth/admin/login-policy — update policy
  if (pathname === '/api/v1/auth/admin/login-policy' && request.method === 'PUT') {
    const body = (await request.json()) as { group_id?: string; allow_standard?: number; allow_oidc?: number };
    if (!body.group_id) return new Response(JSON.stringify({ error: 'group_id_required' }), { status: 400 });
    const res = await authorizeFetch(env, {
      path: `/api/v1/identity/groups/${encodeURIComponent(body.group_id)}/login-policy`,
      method: 'PUT',
      body: JSON.stringify({ allow_standard: body.allow_standard, allow_oidc: body.allow_oidc }),
    });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await fetchInner(request, env);
    } catch (e) {
      console.error('[worker] unhandled error', request.method, request.url, String(e), e instanceof Error ? e.stack : undefined);
      throw e;
    }
  },
};

async function fetchInner(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (pathname === '/api/v1/spec-document' || pathname === '/api/v1/ui-shell-settings') {
      const apiResponse = await handleDataApiRequest(request, env);
      if (apiResponse) {
        return apiResponse;
      }
    }
    if (pathname === '/api/v1/auth/github/status') {
      const authStatusResponse = await handleGitHubAuthStatus(request, env);
      if (authStatusResponse) {
        return authStatusResponse;
      }
    }
    if (pathname === '/api/v1/auth/status') {
      const authStatusResponse = await handleAuthStatus(request, env);
      if (authStatusResponse) {
        return authStatusResponse;
      }
    }
    if (pathname === '/api/v1/auth/identity-status') {
      const res = await handleIdentityStatus(request, env);
      if (res) return res;
    }
    if (pathname === '/api/v1/auth/magic-link' && request.method === 'POST') {
      const res = await handleMagicLinkRequest(request, env);
      if (res) return res;
    }
    if (pathname === '/api/v1/auth/member-check' && request.method === 'GET') {
      const res = await handleMemberCheck(request, env);
      if (res) return res;
    }
    if (pathname === '/auth/magic') {
      const res = await handleMagicLinkVerify(request, env);
      if (res) return res;
    }
    if (/^\/login\/[0-9a-f-]{36}$/i.test(pathname) && request.method === 'GET') {
      const res = await handleGroupLoginPage(request, env, CLIENT_JS_PATH);
      if (res) return res;
    }
    if (/^\/login\/[a-z0-9][a-z0-9-]*[a-z0-9]$/i.test(pathname) && request.method === 'GET') {
      const res = await handleOrgSlugLogin(request, env);
      if (res) return res;
    }
    if (pathname === '/org-group-select' && request.method === 'GET') {
      const res = await handleOrgGroupSelectPage(request, env);
      if (res) return res;
    }
    if (pathname === '/api/v1/auth/org-groups' && request.method === 'GET') {
      const res = await handleOrgGroupsApi(request, env);
      if (res) return res;
    }
    if (pathname === '/api/v1/auth/organizations' && request.method === 'POST') {
      const res = await handleOrgCreate(request, env);
      if (res) return res;
    }
    if (/^\/api\/v1\/auth\/organizations\/[^/]+\/name$/.test(pathname) && request.method === 'PUT') {
      const res = await handleOrgRename(request, env);
      if (res) return res;
    }
    if (pathname === '/api/v1/auth/auto-select-org' && request.method === 'GET') {
      const res = await handleAutoSelectOrg(request, env);
      if (res) return res;
    }
    if (pathname === '/api/v1/auth/select-org' && request.method === 'GET') {
      const res = await handleSelectOrg(request, env);
      if (res) return res;
    }
    if (pathname.startsWith('/api/v1/auth/members')) {
      const res = await handleOrgMembers(request, env);
      if (res) return res;
    }
    if (pathname === '/api/v1/auth/logout' && request.method === 'POST') {
      const headers = new Headers();
      for (const c of [...clearGitHubSessionCookies(request), ...clearGitHubConnectSessionCookies(request), ...clearGoogleSessionCookies(request), ...clearMicrosoftSessionCookies(request), ...clearOidcSessionCookies(request)]) {
        headers.append('Set-Cookie', c);
      }
      for (const c of identityClearCookies()) headers.append('Set-Cookie', c);
      headers.append('Set-Cookie', `login_intent=; Path=/; Max-Age=0; SameSite=Lax`);
      return new Response(null, { status: 204, headers });
    }
    if (pathname === '/api/v1/auth/github/logout' && request.method === 'POST') {
      const headers = new Headers();
      for (const c of [...clearGitHubSessionCookies(request), ...clearGitHubConnectSessionCookies(request)]) {
        headers.append('Set-Cookie', c);
      }
      return new Response(null, { status: 204, headers });
    }
    if (pathname === '/api/v1/auth/google/logout' && request.method === 'POST') {
      const headers = new Headers();
      for (const c of clearGoogleSessionCookies(request)) headers.append('Set-Cookie', c);
      return new Response(null, { status: 204, headers });
    }
    if (pathname === '/api/v1/auth/microsoft/logout' && request.method === 'POST') {
      const headers = new Headers();
      for (const c of clearMicrosoftSessionCookies(request)) headers.append('Set-Cookie', c);
      return new Response(null, { status: 204, headers });
    }
    if (pathname === '/identify-viewer' || pathname === '/org-select') {
      return new Response(null, { status: 302, headers: new Headers({ Location: '/group-select' }) });
    }
    if (pathname === '/oauth/github/logout' && request.method === 'GET') {
      const headers = new Headers({ Location: '/' });
      for (const c of [...clearGitHubSessionCookies(request), ...clearGitHubConnectSessionCookies(request)]) {
        headers.append('Set-Cookie', c);
      }
      for (const c of identityClearCookies()) headers.append('Set-Cookie', c);
      headers.append('Set-Cookie', `login_intent=; Path=/; Max-Age=0; SameSite=Lax`);
      return new Response(null, { status: 302, headers });
    }
    if (pathname === '/oauth/google/logout' && request.method === 'GET') {
      const headers = new Headers({ Location: '/' });
      for (const c of clearGoogleSessionCookies(request)) headers.append('Set-Cookie', c);
      for (const c of identityClearCookies()) headers.append('Set-Cookie', c);
      headers.append('Set-Cookie', `login_intent=; Path=/; Max-Age=0; SameSite=Lax`);
      return new Response(null, { status: 302, headers });
    }
    if (pathname === '/oauth/microsoft/logout' && request.method === 'GET') {
      const headers = new Headers({ Location: '/' });
      for (const c of clearMicrosoftSessionCookies(request)) headers.append('Set-Cookie', c);
      for (const c of identityClearCookies()) headers.append('Set-Cookie', c);
      headers.append('Set-Cookie', `login_intent=; Path=/; Max-Age=0; SameSite=Lax`);
      return new Response(null, { status: 302, headers });
    }
    // GitHub login (read:user scope — identity only)
    if (pathname === '/oauth/github/start' || pathname === '/github/oauth/start') {
      return handleGitHubOAuthStart({ request, env });
    }
    if (pathname === '/oauth/github/callback' || pathname === '/github/oauth/callback') {
      return handleGitHubOAuthCallback({ request, env });
    }
    // GitHub connect (resource access scopes)
    if (pathname === '/oauth/github/connect/start') {
      return handleGitHubConnectStart({ request, env });
    }
    if (pathname === '/oauth/github/connect/callback') {
      return handleGitHubConnectCallback({ request, env });
    }
    // Google login (openid email profile)
    if (pathname === '/oauth/google/start') {
      return handleGoogleLoginStart({ request, env });
    }
    if (pathname === '/oauth/google/callback') {
      return handleGoogleLoginCallback({ request, env });
    }
    // Microsoft login (OIDC — openid email profile)
    if (pathname === '/oauth/microsoft/start') {
      return handleMicrosoftLoginStart({ request, env });
    }
    if (pathname === '/oauth/microsoft/callback') {
      return handleMicrosoftLoginCallback({ request, env });
    }
    // Generic OIDC login (org-specific IdP)
    const oidcStartMatch = pathname.match(/^\/oauth\/oidc\/start\/([^/]+)$/);
    if (oidcStartMatch) {
      return handleOidcLoginStart({ request, env }, decodeURIComponent(oidcStartMatch[1]));
    }
    if (pathname === '/oauth/oidc/callback') {
      return handleOidcLoginCallback({ request, env });
    }
    if (/^\/auth\/saml\/[^/]+\/metadata$/.test(pathname)) {
      const res = await handleSamlMetadata({ request, env });
      if (res) return res;
    }
    if (/^\/auth\/saml\/[^/]+\/sso$/.test(pathname)) {
      const res = await handleSamlSsoStart({ request, env });
      if (res) return res;
    }
    if (/^\/auth\/saml\/[^/]+\/acs$/.test(pathname)) {
      const res = await handleSamlAcs({ request, env });
      if (res) return res;
    }
    if (pathname === '/oauth/oidc/logout' && request.method === 'GET') {
      const headers = new Headers({ Location: '/' });
      for (const c of clearOidcSessionCookies(request)) headers.append('Set-Cookie', c);
      for (const c of identityClearCookies()) headers.append('Set-Cookie', c);
      headers.append('Set-Cookie', `login_intent=; Path=/; Max-Age=0; SameSite=Lax`);
      return new Response(null, { status: 302, headers });
    }
    // Provider-agnostic logout: clears the identity session (which outlives provider
    // cookies) plus any residual provider sessions. Used by the nav when only an
    // identity session remains.
    if (pathname === '/oauth/logout' && request.method === 'GET') {
      const headers = new Headers({ Location: '/' });
      for (const c of [...clearGitHubSessionCookies(request), ...clearGitHubConnectSessionCookies(request), ...clearGoogleSessionCookies(request), ...clearMicrosoftSessionCookies(request), ...clearOidcSessionCookies(request)]) {
        headers.append('Set-Cookie', c);
      }
      for (const c of identityClearCookies()) headers.append('Set-Cookie', c);
      headers.append('Set-Cookie', `login_intent=; Path=/; Max-Age=0; SameSite=Lax`);
      return new Response(null, { status: 302, headers });
    }

    if (pathname === '/.well-known/oauth-authorization-server') {
      return handleOAuthMetadata(request, env);
    }
    if (pathname === '/.well-known/openid-configuration') {
      return handleOpenIDConfiguration(request, env);
    }
    if (pathname === '/.well-known/jwks.json') {
      return handleJwks(request, env);
    }
    if (pathname === '/oauth/mcp/register' && request.method === 'POST') {
      return handleMcpRegister(request, env);
    }
    if (pathname === '/oauth/mcp/authorize') {
      return handleMcpAuthorize(request, env);
    }
    if (pathname === '/oauth/mcp/select-org') {
      return handleMcpSelectOrg(request, env);
    }
    if (pathname === '/oauth/mcp/approve' && request.method === 'POST') {
      return handleMcpApprove(request, env);
    }
    if (pathname === '/oauth/mcp/create-org' && request.method === 'POST') {
      return handleMcpCreateOrg(request, env);
    }
    if (pathname === '/oauth/mcp/token' && request.method === 'POST') {
      return handleMcpToken(request, env);
    }
    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      return handleMcp(request, env);
    }

    // Public identity API proxy — group login page reads these without a session
    const groupIdentityMatch = pathname.match(/^\/api\/v1\/identity\/groups\/([^/]+)\/(oidc-providers|login-policy)$/);
    if (groupIdentityMatch && request.method === 'GET') {
      const res = await authorizeFetch(env, { path: pathname, method: 'GET' });
      return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }

    // OIDC admin API proxy (requires session — auth gate handled below)
    if (pathname.startsWith('/api/v1/auth/admin/oidc') || pathname.startsWith('/api/v1/auth/admin/login-policy')) {
      return handleAdminOidcApi(request, env);
    }

    if (pathname.startsWith('/api/')) {
      try {
        return await handleLayoutApiRequest(request, env);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(msg, { status: 500 });
      }
    }

    // Public stance test page — served before the auth gate (no login required).
    if (pathname === '/public' && request.method === 'GET') {
      return renderPublicStancePage(request, env);
    }

    // Auth gate: check session before serving any HTML
    if (isNavigationRequest(request) && !isPublicPath(pathname)) {
      const { userId, orgId } = await getNavCookies(request, env);
      if (!userId) {
        const returnTo = encodeURIComponent(pathname);
        return Response.redirect(new URL(`/login?returnTo=${returnTo}`, request.url).href, 302);
      }
      if (!orgId && pathname !== '/group-select') {
        const returnTo = encodeURIComponent(pathname);
        return Response.redirect(new URL(`/group-select?returnTo=${returnTo}`, request.url).href, 302);
      }
    }

    let assetsResponse: Response | null = null;
    try {
      assetsResponse = await env.ASSETS.fetch(request);
    } catch {
      // ASSETS binding threw (Miniflare/Wrangler edge case); fall through to navigation response
    }

    // Inject Turnstile site key into /login HTML served from static assets
    if (assetsResponse?.ok && pathname === '/login' && isNavigationRequest(request)) {
      const siteKey = env.TURNSTILE_SITE_KEY ?? '';
      const injection = `<script>window.__TURNSTILE_SITE_KEY__=${JSON.stringify(siteKey)}</script>`
        + (siteKey ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>` : '');
      const html = (await assetsResponse.text()).replace('</head>', `${injection}</head>`);
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
    }

    if (assetsResponse !== null && (assetsResponse.status !== 404 || !isNavigationRequest(request))) {
      return assetsResponse;
    }

    if (!isNavigationRequest(request)) {
      return new Response('Not Found', { status: 404 });
    }

    return new Response(`<!doctype html><script type="module" src="${CLIENT_JS_PATH}"></script>`, {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
}
