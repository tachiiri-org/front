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
import { handleApiRequest as handleDataApiRequest, handleGitHubAuthStatus, handleAuthStatus, handleIdentityStatus, handleOrgCreate, handleSelectOrg, handleOrgMembers, handleAutoSelectOrg } from './routes/data';
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
import { clearGitHubSessionCookies, clearGitHubConnectSessionCookies, clearGoogleSessionCookies, clearMicrosoftSessionCookies } from './identify';

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
  return { userId: get('identity_user_id'), orgId: get('identity_org_id') };
};

const isPublicPath = (pathname: string): boolean =>
  pathname === '/login' ||
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
      for (const c of [...clearGitHubSessionCookies(request), ...clearGitHubConnectSessionCookies(request), ...clearGoogleSessionCookies(request), ...clearMicrosoftSessionCookies(request)]) {
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
        return Response.redirect('/login', 302);
      }
      if (!orgId && pathname !== '/group-select') {
        return Response.redirect('/group-select', 302);
      }
    }

    let assetsResponse: Response | null = null;
    try {
      assetsResponse = await env.ASSETS.fetch(request);
    } catch {
      // ASSETS binding threw (Miniflare/Wrangler edge case); fall through to navigation response
    }

    if (assetsResponse !== null && (assetsResponse.status !== 404 || !isNavigationRequest(request))) {
      return assetsResponse;
    }

    if (!isNavigationRequest(request)) {
      return new Response('Not Found', { status: 404 });
    }

    if (pathname === '/login') {
      return new Response(
        `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Login</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #111827; color: #d1d5db; font-family: monospace; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: #1f2937; border: 1px solid #374151; border-radius: 8px; padding: 40px; width: 320px; }
  h1 { font-size: 18px; font-weight: 600; color: #f9fafb; margin-bottom: 32px; text-align: center; }
  .btn { display: block; width: 100%; padding: 10px 16px; margin-bottom: 12px; border: 1px solid #374151; border-radius: 6px; background: #374151; color: #f9fafb; font-family: monospace; font-size: 13px; text-decoration: none; text-align: center; cursor: pointer; }
  .btn:hover { background: #4b5563; }
</style>
</head>
<body>
<div class="card">
  <h1>Login</h1>
  <a class="btn" href="/oauth/github/start">Login with GitHub</a>
  <a class="btn" href="/oauth/google/start">Login with Google</a>
  <a class="btn" href="/oauth/microsoft/start">Login with Microsoft</a>
</div>
</body>
</html>`,
        { headers: { 'Content-Type': 'text/html; charset=UTF-8' } },
      );
    }

    return new Response(`<!doctype html><script type="module" src="${CLIENT_JS_PATH}"></script>`, {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  },
};
