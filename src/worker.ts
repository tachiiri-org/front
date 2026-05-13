import { handleApiRequest } from './web/api/layout';
import { handleMcp } from './mcp/handler';
import { authorizeFetch } from './auth';
import { setGithubToken } from './mcp/token-store';
import type { LayoutsEnv } from './web/storage/layouts/r2';
import type { AuthorizeEnv } from './auth';

type Env = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
} & LayoutsEnv & AuthorizeEnv;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      return handleMcp(request, env);
    }
    if (pathname === '/oauth/github/callback') {
      const code = url.searchParams.get('code');
      if (!code) return new Response('Missing code', { status: 400 });
      const res = await authorizeFetch(env, {
        path: '/api/v1/github/login/oauth/access_token',
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const text = await res.text();
        return new Response(`OAuth exchange failed: ${text}`, { status: 500 });
      }
      const data = await res.json() as { access_token?: string };
      if (!data.access_token) {
        return new Response(`Token exchange succeeded but no access_token: ${JSON.stringify(data)}`, { status: 500 });
      }
      setGithubToken(data.access_token);
      return new Response('GitHub authentication successful. You can close this tab.', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    return handleApiRequest(request, env);
  },
};
