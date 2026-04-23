import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SpecDocument } from '@shared/spec-document';

import { createWebSpecDocumentRepository } from './spec-document-repository';

const sampleDocument: SpecDocument = {
  concerns: [],
  screens: [],
  tools: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createWebSpecDocumentRepository', () => {
  it('loads the document from the configured API origin', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(sampleDocument), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const repository = createWebSpecDocumentRepository('https://api.example.test');

    await expect(repository.load()).resolves.toEqual(sampleDocument);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/spec-document', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      method: 'GET',
    });
  });

  it('loads the document from the same-origin API when no API origin is configured', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(sampleDocument), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const repository = createWebSpecDocumentRepository('');

    await expect(repository.load()).resolves.toEqual(sampleDocument);
    expect(fetchMock).toHaveBeenCalledWith('/api/spec-document', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      method: 'GET',
    });
  });

  it('saves the document through the configured API origin', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(sampleDocument), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const repository = createWebSpecDocumentRepository('https://api.example.test');

    await expect(repository.save(sampleDocument)).resolves.toEqual(sampleDocument);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/spec-document', {
      body: `${JSON.stringify(sampleDocument, null, 2)}\n`,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'PUT',
    });
  });
});
