import type { SpecDocument } from '@shared/spec-document';

import type { SpecDocumentRepository } from '../contracts';

import { fetchJson, resolveApiUrl } from './fetch-json';

export const createWebSpecDocumentRepository = (apiOrigin: string): SpecDocumentRepository => {
  const endpoint = resolveApiUrl(apiOrigin, '/api/spec-document');

  return {
    load: async () =>
      fetchJson<SpecDocument | null>(endpoint, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        method: 'GET',
      }),
    save: async (document) =>
      fetchJson<SpecDocument>(endpoint, {
        body: `${JSON.stringify(document, null, 2)}\n`,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      }),
  };
};
