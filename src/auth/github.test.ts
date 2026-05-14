import { describe, expect, it } from 'vitest';

import { handleGitHubOAuthCallback, handleGitHubOAuthStart } from './github';

describe('handleGitHubOAuthStart', () => {
  it('redirects localhost through IDENTIFY_ORIGIN', () => {
    const response = handleGitHubOAuthStart({
      request: new Request('https://front.example.com/oauth/github/start?scope=repo+read%3Auser'),
      env: {
        GITHUB_OAUTH_CLIENT_ID: 'github-client-id',
        IDENTIFY_ORIGIN: 'https://identify-local.tachiiri.workers.dev',
      },
    } as never);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      'https://identify-local.tachiiri.workers.dev/github/oauth/start?scope=repo+read%3Auser',
    );
  });
});

describe('handleGitHubOAuthCallback', () => {
  it('redirects localhost callback through IDENTIFY_ORIGIN', async () => {
    const response = await handleGitHubOAuthCallback({
      request: new Request('https://front.example.com/oauth/github/callback?code=abc&state=xyz'),
      env: {
        IDENTIFY_ORIGIN: 'https://identify-local.tachiiri.workers.dev',
      },
    } as never);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      'https://identify-local.tachiiri.workers.dev/github/oauth/callback?code=abc&state=xyz',
    );
  });
});
