import { describe, expect, it } from 'vitest';

import { handleGitHubOAuthStart, handleGitHubOAuthCallback } from './github';

describe('handleGitHubOAuthStart', () => {
  it('redirects to GitHub authorize with client ID', () => {
    const response = handleGitHubOAuthStart({
      request: new Request('https://front.example.com/oauth/github/start?scope=repo+read%3Auser'),
      env: {
        GITHUB_OAUTH_CLIENT_ID: 'test-client-id',
        FRONTEND_ORIGIN: 'https://front.example.com',
      },
    } as never);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.hostname).toBe('github.com');
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(location.searchParams.get('scope')).toBe('repo read:user');
  });

  it('returns 503 when GITHUB_OAUTH_CLIENT_ID is missing', () => {
    const response = handleGitHubOAuthStart({
      request: new Request('https://front.example.com/oauth/github/start'),
      env: {},
    } as never);

    expect(response.status).toBe(503);
  });
});

describe('handleGitHubOAuthCallback', () => {
  it('returns 400 when state cookie is missing', async () => {
    const response = await handleGitHubOAuthCallback({
      request: new Request('https://front.example.com/oauth/github/callback?code=abc&state=xyz'),
      env: {},
    } as never);

    expect(response.status).toBe(400);
  });

  it('returns 400 when state does not match cookie', async () => {
    const response = await handleGitHubOAuthCallback({
      request: new Request('https://front.example.com/oauth/github/callback?code=abc&state=xyz', {
        headers: { Cookie: 'github_explorer_oauth_state=different-state' },
      }),
      env: {},
    } as never);

    expect(response.status).toBe(400);
  });
});
