import { describe, expect, it } from 'vitest';
import {
  handleComponentSchemaDefinitionGet,
  handleComponentSchemaPut,
  SCHEMA_TABLE_SCHEMA,
} from '../src/api/component-schemas';
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

  it('stores style fields with key as spec key', async () => {
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
                type: 'style',
                key: 'padding',
                label: 'padding',
                options_json: '',
                fields_json: '',
              },
            },
          ],
        },
      }),
    });

    const response = await handleComponentSchemaPut(request, backend, 'element');
    expect(response.status).toBe(200);
    expect(JSON.parse(writes['schemas/element.json'])).toEqual([
      { kind: 'style', key: 'padding', label: 'padding' },
    ]);
  });

  it('migrates legacy padding fields when reading component schema definitions', async () => {
    const backend: LayoutBackend = {
      async list() {
        return { objects: [], truncated: false };
      },
      async getText(key: string) {
        if (key === 'schemas/element.json') {
          return JSON.stringify([{ kind: 'text-field', key: 'padding', label: 'padding' }]);
        }
        return null;
      },
      async putText() {},
      async deleteKey() {},
    };

    const response = await handleComponentSchemaDefinitionGet(backend, 'element');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { kind: 'style', key: 'padding', label: 'padding' },
    ]);
  });

  it('exposes margin style fields in the component-editor schema definition', async () => {
    const backend: LayoutBackend = {
      async list() {
        return { objects: [], truncated: false };
      },
      async getText() {
        return null;
      },
      async putText() {},
      async deleteKey() {},
    };

    const response = await handleComponentSchemaDefinitionGet(backend, 'component-editor');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { kind: 'text-field', key: 'name', label: 'name' },
      {
        kind: 'select',
        key: 'sourceCanvasId',
        label: 'source',
        source: {
          kind: 'endpoint',
          url: '/api/layouts/:screenId/canvases',
          itemsPath: 'items',
          valueKey: 'value',
          labelKey: 'label',
        },
      },
      {
        kind: 'object-list',
        key: 'sections',
        label: 'sections',
        fields: [
          {
            kind: 'select',
            key: 'source',
            label: 'source',
            options: [
              { value: 'placement', label: 'placement' },
              { value: 'properties', label: 'properties' },
            ],
          },
          { kind: 'text-field', key: 'label', label: 'label' },
          { kind: 'boolean-field', key: 'collapsible', label: 'collapsible' },
          { kind: 'boolean-field', key: 'defaultCollapsed', label: 'defaultCollapsed' },
        ],
      },
      { kind: 'style', key: 'padding', label: 'padding' },
      { kind: 'style', key: 'margin', label: 'margin' },
    ]);
  });
});
