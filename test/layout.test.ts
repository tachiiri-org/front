import { describe, expect, it } from 'vitest';
import { handleApiRequest } from '../src/routes/layout';
import type { LayoutsEnv } from '../src/web/storage/layouts/r2';

const makeEnv = (objects: Record<string, string> = {}): LayoutsEnv & { ASSETS: { fetch(): Promise<Response> } } => ({
  ASSETS: {
    async fetch() {
      return new Response('not-found', { status: 404 });
    },
  },
  LAYOUTS: {
    async list() {
      return { objects: [], truncated: false, cursor: '' };
    },
    async get(key: string) {
      const value = objects[key];
      return value === undefined ? null : { text: async () => value };
    },
    async put() {
      return undefined;
    },
    async delete() {
      return undefined;
    },
  },
});

describe('layout api', () => {
  it('serves list resources from R2-backed json', async () => {
    const env = makeEnv({
      'list/category.json': JSON.stringify([
        { value: 'component', label: 'component' },
        { value: 'source', label: 'source' },
      ]),
    });

    const response = await handleApiRequest(new Request('http://localhost/api/v1/component-schemas/list/category'), env);
    expect(response.status).toBe(200);
    const payload = await response.json() as { kind: string; data: { rows: Array<{ values: { value: string; label: string } }> } };
    expect(payload.kind).toBe('table');
    expect(payload.data.rows.map((r) => ({ value: r.values.value, label: r.values.label }))).toEqual([
      { value: 'component', label: 'component' },
      { value: 'source', label: 'source' },
    ]);
  });
});
