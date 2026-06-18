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
import { handleApiRequest as handleDataApiRequest, handleGitHubAuthStatus, handleAuthStatus, handleIdentityStatus, handleOrgCreate, handleSelectOrg, handleOrgMembers, handleAutoSelectOrg, handleMagicLinkRequest, handleMagicLinkVerify, handleMemberCheck, handleGroupLoginPage } from './routes/data';
import { handleApiRequest as handleLayoutApiRequest } from './routes/layout';
import { handleMcp } from './mcp/handler';
import {
  handleOAuthMetadata,
  handleMcpRegister,
  handleMcpAuthorize,
  handleMcpSelectOrg,
  handleMcpApprove,
  handleMcpCreateOrg,
  handleMcpToken,
} from './mcp/oauth';
import { clearGitHubSessionCookies, clearGitHubConnectSessionCookies, clearGoogleSessionCookies, clearMicrosoftSessionCookies, clearOidcSessionCookies } from './identify';
import { handleOidcLoginStart, handleOidcLoginCallback } from './session/oidc';
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

const getNavCookies = (request: Request): { userId: string | null; orgId: string | null } => {
  const header = request.headers.get('Cookie') ?? '';
  const get = (name: string): string | null => {
    const m = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  };
  return { userId: get('identity_user_id'), orgId: get('identity_group_id') };
};

const isPublicPath = (pathname: string): boolean =>
  pathname === '/login' ||
  /^\/login\/[0-9a-f-]{36}$/i.test(pathname) ||
  pathname === '/auth/magic' ||
  pathname === '/api/auth/member-check' ||
  pathname.startsWith('/oauth/') ||
  pathname.startsWith('/github/oauth/') ||
  pathname.startsWith('/.well-known/') ||
  pathname.startsWith('/mcp') ||
  pathname.startsWith('/api/') ||
  pathname === '/settings/admin';

const isNavigationRequest = (request: Request): boolean => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('text/html');
};

async function handleAdminOidcApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // POST /api/auth/admin/oidc — create provider
  if (pathname === '/api/auth/admin/oidc' && request.method === 'POST') {
    const body = await request.json();
    const res = await authorizeFetch(env, {
      path: '/api/v1/identity/oidc',
      method: 'POST',
      body: JSON.stringify(body),
    });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }

  // PUT /api/auth/admin/oidc/:oidcId — update provider
  const oidcPutMatch = pathname.match(/^\/api\/auth\/admin\/oidc\/([^/]+)$/);
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

  // DELETE /api/auth/admin/oidc/:oidcId — delete provider
  if (oidcPutMatch && request.method === 'DELETE') {
    const oidcId = decodeURIComponent(oidcPutMatch[1]);
    const res = await authorizeFetch(env, {
      path: `/api/v1/identity/oidc/${encodeURIComponent(oidcId)}`,
      method: 'DELETE',
    });
    return new Response(null, { status: res.status });
  }

  // GET /api/auth/admin/login-policy?group_id=
  if (pathname === '/api/auth/admin/login-policy' && request.method === 'GET') {
    const groupId = url.searchParams.get('group_id');
    if (!groupId) return new Response(JSON.stringify({ error: 'group_id_required' }), { status: 400 });
    const res = await authorizeFetch(env, {
      path: `/api/v1/identity/groups/${encodeURIComponent(groupId)}/login-policy`,
      method: 'GET',
    });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }

  // PUT /api/auth/admin/login-policy — update policy
  if (pathname === '/api/auth/admin/login-policy' && request.method === 'PUT') {
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
    const pathname = new URL(request.url).pathname;

    if (pathname === '/api/spec-document' || pathname === '/api/ui-shell-settings') {
      const apiResponse = await handleDataApiRequest(request, env);
      if (apiResponse) {
        return apiResponse;
      }
    }
    if (pathname === '/api/auth/github/status') {
      const authStatusResponse = await handleGitHubAuthStatus(request, env);
      if (authStatusResponse) {
        return authStatusResponse;
      }
    }
    if (pathname === '/api/auth/status') {
      const authStatusResponse = await handleAuthStatus(request, env);
      if (authStatusResponse) {
        return authStatusResponse;
      }
    }
    if (pathname === '/api/auth/identity-status') {
      const res = await handleIdentityStatus(request, env);
      if (res) return res;
    }
    if (pathname === '/api/auth/magic-link' && request.method === 'POST') {
      const res = await handleMagicLinkRequest(request, env);
      if (res) return res;
    }
    if (pathname === '/api/auth/member-check' && request.method === 'GET') {
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
    if (pathname === '/api/auth/organizations' && request.method === 'POST') {
      const res = await handleOrgCreate(request, env);
      if (res) return res;
    }
    if (pathname === '/api/auth/auto-select-org' && request.method === 'GET') {
      const res = await handleAutoSelectOrg(request, env);
      if (res) return res;
    }
    if (pathname === '/api/auth/select-org' && request.method === 'GET') {
      const res = await handleSelectOrg(request, env);
      if (res) return res;
    }
    if (pathname.startsWith('/api/auth/members')) {
      const res = await handleOrgMembers(request, env);
      if (res) return res;
    }
    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      const headers = new Headers();
      for (const c of [...clearGitHubSessionCookies(request), ...clearGitHubConnectSessionCookies(request), ...clearGoogleSessionCookies(request), ...clearMicrosoftSessionCookies(request), ...clearOidcSessionCookies(request)]) {
        headers.append('Set-Cookie', c);
      }
      return new Response(null, { status: 204, headers });
    }
    if (pathname === '/api/auth/github/logout' && request.method === 'POST') {
      const headers = new Headers();
      for (const c of [...clearGitHubSessionCookies(request), ...clearGitHubConnectSessionCookies(request)]) {
        headers.append('Set-Cookie', c);
      }
      return new Response(null, { status: 204, headers });
    }
    if (pathname === '/api/auth/google/logout' && request.method === 'POST') {
      const headers = new Headers();
      for (const c of clearGoogleSessionCookies(request)) headers.append('Set-Cookie', c);
      return new Response(null, { status: 204, headers });
    }
    if (pathname === '/api/auth/microsoft/logout' && request.method === 'POST') {
      const headers = new Headers();
      for (const c of clearMicrosoftSessionCookies(request)) headers.append('Set-Cookie', c);
      return new Response(null, { status: 204, headers });
    }
    if (pathname === '/identify-viewer') {
      return new Response(null, { status: 302, headers: new Headers({ Location: '/' }) });
    }
    if (pathname === '/oauth/github/logout' && request.method === 'GET') {
      const headers = new Headers({ Location: '/' });
      for (const c of [...clearGitHubSessionCookies(request), ...clearGitHubConnectSessionCookies(request)]) {
        headers.append('Set-Cookie', c);
      }
      return new Response(null, { status: 302, headers });
    }
    if (pathname === '/oauth/google/logout' && request.method === 'GET') {
      const headers = new Headers({ Location: '/' });
      for (const c of clearGoogleSessionCookies(request)) headers.append('Set-Cookie', c);
      return new Response(null, { status: 302, headers });
    }
    if (pathname === '/oauth/microsoft/logout' && request.method === 'GET') {
      const headers = new Headers({ Location: '/' });
      for (const c of clearMicrosoftSessionCookies(request)) headers.append('Set-Cookie', c);
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
    if (pathname === '/oauth/oidc/logout' && request.method === 'GET') {
      const headers = new Headers({ Location: '/' });
      for (const c of clearOidcSessionCookies(request)) headers.append('Set-Cookie', c);
      return new Response(null, { status: 302, headers });
    }

    if (pathname === '/.well-known/oauth-authorization-server') {
      return handleOAuthMetadata(request, env);
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
    if (pathname.startsWith('/api/auth/admin/oidc') || pathname.startsWith('/api/auth/admin/login-policy')) {
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

    // Auth gate: check session before serving any HTML
    if (isNavigationRequest(request) && !isPublicPath(pathname)) {
      const { userId, orgId } = getNavCookies(request);
      if (!userId) {
        return Response.redirect(new URL('/login', request.url).href, 302);
      }
      if (!orgId && pathname !== '/group-select') {
        return Response.redirect(new URL('/group-select', request.url).href, 302);
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
  },
};
