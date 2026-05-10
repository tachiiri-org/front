import { describe, expect, it } from 'vitest';
import { handleComponentSchemaPut, SCHEMA_TABLE_SCHEMA } from '../src/api/component-schemas';
import type { LayoutBackend } from '../src/storage/layouts/r2';

const makeBackend = (): { backend: LayoutBackend; writes: Record<string, string> } => {
  const writes: Record<string, string> = {};
  return {
    writes,
    backend: {
      async list() {
        return { objects: [], truncated: false };
      },
      async getText() {
        return null;
      },
      async putText(key: string, body: string) {
        writes[key] = body;
      },
      async deleteKey() {},
    },
  };
};

describe('component schemas', () => {
  it('uses type as the visible schema column and hides advanced columns', () => {
    const columns = SCHEMA_TABLE_SCHEMA.columns;
    expect(columns.map((column) => column.key)).toEqual([
      'label',
      'key',
      'type',
      'options_json',
      'fields_json',
      'style_json',
      'keys_json',
      'raw_json',
    ]);
    expect(columns.find((column) => column.key === 'type')?.label).toBe('type');
    expect(columns.filter((column) => !column.hidden).map((column) => column.key)).toEqual([
      'label',
      'key',
      'type',
    ]);
  });

  it('accepts table rows keyed by type and stores schema fields with kind', async () => {
    const { backend, writes } = makeBackend();
    const request = new Request('http://localhost/api/component-schemas/element', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          rows: [
            {
              id: '1',
              values: {
                type: 'text',
                key: 'name',
                label: 'name',
                options_json: '',
                fields_json: '',
                style_json: '',
              },
            },
          ],
        },
      }),
    });

    const response = await handleComponentSchemaPut(request, backend, 'element');
    expect(response.status).toBe(200);
    expect(JSON.parse(writes['schemas/element.json'])).toEqual([
      { kind: 'text', key: 'name', label: 'name' },
    ]);
  });
});
