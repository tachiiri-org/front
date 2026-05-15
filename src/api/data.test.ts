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

  it('reads the GitHub session from the identify service binding when no origin is configured', async () => {
    const identify = {
      fetch: vi.fn(async (request: Request) => {
        expect(request.url).toBe('https://identify.internal/internal/github/session');
        expect(request.headers.get('x-front-to-identify-token')).toBe('front-token');
        return Response.json({
          authenticated: true,
          accessToken: 'github-token',
          viewer: {
            login: 'octocat',
            name: 'Mona',
          },
        });
      }),
    };

    const response = await handleGitHubAuthStatus(
      new Request('https://front.example.com/api/auth/github/status'),
      {
        IDENTIFY: identify,
        FRONT_TO_IDENTIFY_TOKEN: 'front-token',
      },
    );

    expect(response).toBeTruthy();
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      authenticated: true,
      login: 'octocat',
    });
    expect(identify.fetch).toHaveBeenCalledOnce();
  });
});
