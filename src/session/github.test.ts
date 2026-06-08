import { describe, expect, it } from 'vitest';

import {
  handleGitHubLoginStart,
  handleGitHubLoginCallback,
  handleGitHubConnectStart,
  handleGitHubConnectCallback,
  handleGitHubOAuthStart,
  handleGitHubOAuthCallback,
} from './github';

describe('handleGitHubLoginStart', () => {
  it('redirects to GitHub authorize with read:user scope only', () => {
    const response = handleGitHubLoginStart({
      request: new Request('https://front.example.com/oauth/github/start'),
      env: {
        GITHUB_OAUTH_CLIENT_ID: 'test-client-id',
        FRONTEND_ORIGIN: 'https://front.example.com',
      },
    } as never);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.hostname).toBe('github.com');
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(location.searchParams.get('scope')).toBe('read:user');
  });

  it('ignores scope query param and always uses read:user', () => {
    const response = handleGitHubLoginStart({
      request: new Request('https://front.example.com/oauth/github/start?scope=repo+read%3Auser'),
      env: {
        GITHUB_OAUTH_CLIENT_ID: 'test-client-id',
        FRONTEND_ORIGIN: 'https://front.example.com',
      },
    } as never);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.searchParams.get('scope')).toBe('read:user');
  });

  it('returns 503 when GITHUB_OAUTH_CLIENT_ID is missing', () => {
    const response = handleGitHubLoginStart({
      request: new Request('https://front.example.com/oauth/github/start'),
      env: {},
    } as never);

    expect(response.status).toBe(503);
  });
});

describe('handleGitHubLoginCallback', () => {
  it('returns 400 when state cookie is missing', async () => {
    const response = await handleGitHubLoginCallback({
      request: new Request('https://front.example.com/oauth/github/callback?code=abc&state=xyz'),
      env: {},
    } as never);

    expect(response.status).toBe(400);
  });

  it('returns 400 when state does not match cookie', async () => {
    const response = await handleGitHubLoginCallback({
      request: new Request('https://front.example.com/oauth/github/callback?code=abc&state=xyz', {
        headers: { Cookie: 'github_login_oauth_state=different-state' },
      }),
      env: {},
    } as never);

    expect(response.status).toBe(400);
  });
});

describe('handleGitHubConnectStart', () => {
  it('redirects to GitHub authorize with repo scope by default', () => {
    const response = handleGitHubConnectStart({
      request: new Request('https://front.example.com/oauth/github/connect/start'),
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
    expect(response.headers.get('Set-Cookie')).toContain('github_connect_oauth_state=');
  });

  it('respects custom scope query param', () => {
    const response = handleGitHubConnectStart({
      request: new Request('https://front.example.com/oauth/github/connect/start?scope=repo'),
      env: {
        GITHUB_OAUTH_CLIENT_ID: 'test-client-id',
        FRONTEND_ORIGIN: 'https://front.example.com',
      },
    } as never);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.searchParams.get('scope')).toBe('repo');
  });

  it('returns 503 when GITHUB_OAUTH_CLIENT_ID is missing', () => {
    const response = handleGitHubConnectStart({
      request: new Request('https://front.example.com/oauth/github/connect/start'),
      env: {},
    } as never);

    expect(response.status).toBe(503);
  });
});

describe('handleGitHubConnectCallback', () => {
  it('returns 400 when state cookie is missing', async () => {
    const response = await handleGitHubConnectCallback({
      request: new Request('https://front.example.com/oauth/github/connect/callback?code=abc&state=xyz'),
      env: {},
    } as never);

    expect(response.status).toBe(400);
  });

  it('returns 400 when state does not match cookie', async () => {
    const response = await handleGitHubConnectCallback({
      request: new Request('https://front.example.com/oauth/github/connect/callback?code=abc&state=xyz', {
        headers: { Cookie: 'github_connect_oauth_state=different-state' },
      }),
      env: {},
    } as never);

    expect(response.status).toBe(400);
  });
});

// Backward-compatibility: deprecated aliases still work
describe('handleGitHubOAuthStart (deprecated alias)', () => {
  it('delegates to handleGitHubLoginStart', () => {
    const response = handleGitHubOAuthStart({
      request: new Request('https://front.example.com/oauth/github/start'),
      env: {
        GITHUB_OAUTH_CLIENT_ID: 'test-client-id',
        FRONTEND_ORIGIN: 'https://front.example.com',
      },
    } as never);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.searchParams.get('scope')).toBe('read:user');
  });
});

describe('handleGitHubOAuthCallback (deprecated alias)', () => {
  it('returns 400 when state cookie is missing', async () => {
    const response = await handleGitHubOAuthCallback({
      request: new Request('https://front.example.com/oauth/github/callback?code=abc&state=xyz'),
      env: {},
    } as never);

    expect(response.status).toBe(400);
  });
});
