import { handleGitHubOAuthCallback, handleGitHubOAuthStart } from './auth/github';
import type { AuthorizeEnv } from './auth';

type AssetsEnv = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
};

type Env = AssetsEnv & AuthorizeEnv;

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

    if (pathname === '/oauth/github/start') {
      return handleGitHubOAuthStart({ request, env });
    }
    if (pathname === '/oauth/github/callback') {
      return handleGitHubOAuthCallback({ request, env });
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || !isNavigationRequest(request)) {
      return response;
    }

    const url = new URL(request.url);
    const indexRequest = new Request(new URL('/index.html', url), request);

    return env.ASSETS.fetch(indexRequest);
  },
};
