import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

import { authorizeFetch } from './fetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authorizeFetch', () => {
  let privateKeyJwk: string;

  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
  });

  beforeEach(async () => {
    const keyPair = (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    privateKeyJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', keyPair.privateKey));
  });

  it('prefers AUTHORIZE_ORIGIN over the authorize service binding', async () => {
    const authorize = {
      fetch: vi.fn(async () => new Response('should not be used', { status: 500 })),
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://authorize-local.tachiiri.workers.dev/health');
      return new Response('ok', { status: 200 });
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      authorizeFetch(
        {
          AUTHORIZE: authorize,
          AUTHORIZE_ORIGIN: 'https://authorize-local.tachiiri.workers.dev',
          FRONT_TO_AUTHORIZE_TOKEN: 'internal-token',
          INTERNAL_AUTH_SIGNING_KEY: privateKeyJwk,
        },
        { path: '/health', method: 'GET' },
      ),
    ).resolves.toMatchObject({ status: 200 });

    expect(authorize.fetch).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
