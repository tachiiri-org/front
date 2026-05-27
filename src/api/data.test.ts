import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

import { handleGitHubAuthStatus } from './data';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

let privateKeyJwk: string;

beforeEach(async () => {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  privateKeyJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', keyPair.privateKey));
});

describe('handleGitHubAuthStatus', () => {
  it('reads the GitHub session from backend', async () => {
    const backend = {
      fetch: vi.fn(async (request: Request) => {
        expect(request.url).toBe('https://backend.local/api/v1/identify/session/github');
        return Response.json({
          authenticated: true,
          accessToken: 'github-token',
          viewer: { login: 'octocat', name: 'Mona' },
        });
      }),
    };

    const response = await handleGitHubAuthStatus(
      new Request('https://front.example.com/api/auth/github/status'),
      {
        BACKEND: backend,
        FRONT_TO_BACKEND_TOKEN: 'backend-token',
        INTERNAL_AUTH_SIGNING_KEY: privateKeyJwk,
      },
    );

    expect(response).toBeTruthy();
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      authenticated: true,
      login: 'octocat',
    });
    expect(backend.fetch).toHaveBeenCalledOnce();
  });

  it('returns unauthenticated when no session exists', async () => {
    const backend = {
      fetch: vi.fn(async () => new Response(null, { status: 404 })),
    };

    const response = await handleGitHubAuthStatus(
      new Request('https://front.example.com/api/auth/github/status'),
      {
        BACKEND: backend,
        FRONT_TO_BACKEND_TOKEN: 'backend-token',
        INTERNAL_AUTH_SIGNING_KEY: privateKeyJwk,
      },
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      authenticated: false,
      login: null,
    });
  });
});
