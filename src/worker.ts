import { handleApiRequest } from './web/api/layout';
import { handleMcp } from './mcp/handler';
import { handleGitHubOAuthCallback, handleGitHubOAuthStart } from './auth/github';
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
    if (pathname === '/oauth/github/start') {
      return handleGitHubOAuthStart({ request, env });
    }
    if (pathname === '/oauth/github/callback') {
      return handleGitHubOAuthCallback({ request, env });
    }
    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      return handleMcp(request, env);
    }
    return handleApiRequest(request, env);
  },
};
