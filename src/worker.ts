import { handleGitHubOAuthCallback, handleGitHubOAuthStart } from './auth/github';
import type { AuthorizeEnv } from './auth';
import { handleApiRequest, handleGitHubAuthStatus } from './api/data';

type AssetsEnv = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  readonly LAYOUTS?: {
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

    if (pathname === '/api/spec-document' || pathname === '/api/ui-shell-settings') {
      const apiResponse = await handleApiRequest(request, env);
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
    if (pathname === '/oauth/github/start' || pathname === '/github/oauth/start') {
      return handleGitHubOAuthStart({ request, env });
    }
    if (pathname === '/oauth/github/callback' || pathname === '/github/oauth/callback') {
      return handleGitHubOAuthCallback({ request, env });
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || !isNavigationRequest(request)) {
      return response;
    }

    return new Response('<!doctype html><script type="module" src="/assets/index.js"></script>', {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  },
};
