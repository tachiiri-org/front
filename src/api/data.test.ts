import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleGitHubAuthStatus } from './data';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handleGitHubAuthStatus', () => {
  it('reads the GitHub session from IDENTIFY_ORIGIN', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://identify-local.tachiiri.workers.dev/github/session');
      return Response.json({
        connected: true,
        viewer: {
          login: 'octocat',
          name: 'Mona',
        },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const response = await handleGitHubAuthStatus(
      new Request('https://front.example.com/api/auth/github/status'),
      {
        IDENTIFY_ORIGIN: 'https://identify-local.tachiiri.workers.dev',
      },
    );

    expect(response).toBeTruthy();
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      authenticated: true,
      login: 'octocat',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
