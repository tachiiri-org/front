import { describe, expect, it } from 'vitest';
import {
  handleComponentSchemasList,
  handleComponentSchemaDefinitionGet,
  handleComponentSchemaGet,
  handleComponentSchemaPut,
  SCHEMA_TABLE_SCHEMA,
  STYLE_TABLE_SCHEMA,
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
    expect(JSON.parse(writes['component/element.json'])).toEqual([
      { kind: 'text', key: 'name', label: 'name' },
    ]);
  });

  it('stores style specs in the style namespace', async () => {
    const { backend, writes } = makeBackend();
    const request = new Request('http://localhost/api/component-schemas/padding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          rows: [
            {
              id: '1',
              values: {
                key: 't',
                label: 't',
                target: 'paddingTop',
                placeholder: '',
                defaultValue: '',
                raw_json: '',
              },
            },
          ],
        },
      }),
    });

    const response = await handleComponentSchemaPut(request, backend, 'padding');
    expect(response.status).toBe(200);
    expect(JSON.parse(writes['style/padding.json'])).toEqual([
      { key: 't', label: 't', target: 'paddingTop' },
    ]);
  });

  it('lists only current style keys in the style category', async () => {
    const response = handleComponentSchemasList(new URLSearchParams('category=style'));
    const payload = await response.json() as { items: Array<{ value: string; label: string }> };

    expect(payload.items.some((item) => item.value === 'paddingTop')).toBe(false);
    expect(payload.items.some((item) => item.value === 'marginTop')).toBe(false);
    expect(payload.items.some((item) => item.value === 'padding')).toBe(true);
    expect(payload.items.some((item) => item.value === 'margin')).toBe(true);
  });

  it('lists source schemas in the source category', async () => {
    const response = handleComponentSchemasList(new URLSearchParams('category=source'));
    const payload = await response.json() as { items: Array<{ value: string; label: string }> };

    expect(payload.items.some((item) => item.value === 'source/endpoint')).toBe(true);
    expect(payload.items.some((item) => item.value === 'source/list')).toBe(true);
    expect(payload.items.find((item) => item.value === 'source/endpoint')?.label).toBe('endpoint');
    expect(payload.items.find((item) => item.value === 'source/list')?.label).toBe('list');
  });

  it('lists source endpoint and list schemas in their own categories', async () => {
    const endpointResponse = handleComponentSchemasList(new URLSearchParams('category=endpoint'));
    const endpointPayload = await endpointResponse.json() as { items: Array<{ value: string; label: string }> };
    expect(endpointPayload.items.some((item) => item.value === 'source/endpoint')).toBe(true);

    const listResponse = handleComponentSchemasList(new URLSearchParams('category=list'));
    const listPayload = await listResponse.json() as { items: Array<{ value: string; label: string }> };
    expect(listPayload.items.some((item) => item.value === 'list/category')).toBe(true);
    expect(listPayload.items.find((item) => item.value === 'list/category')?.label).toBe('category');
    expect(listPayload.items.some((item) => item.value === 'source/list')).toBe(false);
  });

  it('migrates legacy padding fields when reading component schema definitions', async () => {
    const backend: LayoutBackend = {
      async list() {
        return { objects: [], truncated: false };
      },
      async getText(key: string) {
        if (key === 'component/element.json') {
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

  it('returns style spec rows for the style editor table', async () => {
    const backend: LayoutBackend = {
      async list() {
        return { objects: [], truncated: false };
      },
      async getText(key: string) {
        if (key === 'style/padding.json') {
          return JSON.stringify([
            { key: 't', label: 't', target: 'paddingTop' },
            { key: 'r', label: 'r', target: 'paddingRight' },
            { key: 'b', label: 'b', target: 'paddingBottom' },
            { key: 'l', label: 'l', target: 'paddingLeft' },
          ]);
        }
        return null;
      },
      async putText() {},
      async deleteKey() {},
    };

    const response = await handleComponentSchemaGet(backend, 'padding');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      kind: 'table',
      schema: STYLE_TABLE_SCHEMA,
      data: {
        rows: [
          { id: '0', values: { key: 't', label: 't', target: 'paddingTop', placeholder: '', defaultValue: '', raw_json: JSON.stringify({ key: 't', label: 't', target: 'paddingTop' }) } },
          { id: '1', values: { key: 'r', label: 'r', target: 'paddingRight', placeholder: '', defaultValue: '', raw_json: JSON.stringify({ key: 'r', label: 'r', target: 'paddingRight' }) } },
          { id: '2', values: { key: 'b', label: 'b', target: 'paddingBottom', placeholder: '', defaultValue: '', raw_json: JSON.stringify({ key: 'b', label: 'b', target: 'paddingBottom' }) } },
          { id: '3', values: { key: 'l', label: 'l', target: 'paddingLeft', placeholder: '', defaultValue: '', raw_json: JSON.stringify({ key: 'l', label: 'l', target: 'paddingLeft' }) } },
        ],
      },
    });
  });

  it('returns the source endpoint schema definition', async () => {
    const backend: LayoutBackend = {
      async list() {
        return { objects: [], truncated: false };
      },
      async getText(key: string) {
        if (key === 'source/endpoint.json') {
          return JSON.stringify([
            { kind: 'text-field', key: 'name', label: 'name' },
            { kind: 'text-field', key: 'url', label: 'url' },
            { kind: 'text-field', key: 'itemsPath', label: 'itemsPath' },
            { kind: 'text-field', key: 'valueKey', label: 'valueKey' },
            { kind: 'text-field', key: 'labelKey', label: 'labelKey' },
            { kind: 'textarea-field', key: 'headers_json', label: 'headers_json' },
          ]);
        }
        return null;
      },
      async putText() {},
      async deleteKey() {},
    };

    const response = await handleComponentSchemaDefinitionGet(backend, 'source/endpoint');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { kind: 'text', key: 'name', label: 'name' },
      { kind: 'text', key: 'url', label: 'url' },
      { kind: 'text', key: 'itemsPath', label: 'itemsPath' },
      { kind: 'text', key: 'valueKey', label: 'valueKey' },
      { kind: 'text', key: 'labelKey', label: 'labelKey' },
      { kind: 'textarea', key: 'headers_json', label: 'headers_json' },
    ]);
  });

  it('returns the source list schema definition', async () => {
    const backend: LayoutBackend = {
      async list() {
        return { objects: [], truncated: false };
      },
      async getText(key: string) {
        if (key === 'source/list.json') {
          return JSON.stringify([
            { kind: 'text-field', key: 'name', label: 'name' },
            {
              kind: 'object-list',
              key: 'items',
              label: 'items',
              fields: [
                { kind: 'text-field', key: 'value', label: 'value' },
                { kind: 'text-field', key: 'label', label: 'label' },
              ],
            },
          ]);
        }
        return null;
      },
      async putText() {},
      async deleteKey() {},
    };

    const response = await handleComponentSchemaDefinitionGet(backend, 'source/list');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { kind: 'text', key: 'name', label: 'name' },
      {
        kind: 'object-list',
        key: 'items',
        label: 'items',
        fields: [
          { kind: 'text', key: 'value', label: 'value' },
          { kind: 'text', key: 'label', label: 'label' },
        ],
      },
    ]);
  });

  it('returns the list category table schema', async () => {
    const backend: LayoutBackend = {
      async list() {
        return { objects: [], truncated: false };
      },
      async getText(key: string) {
        if (key === 'list/category.json') {
          return JSON.stringify([
            { value: 'component', label: 'component' },
            { value: 'source', label: 'source' },
          ]);
        }
        return null;
      },
      async putText() {},
      async deleteKey() {},
    };

    const response = await handleComponentSchemaGet(backend, 'list/category');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      kind: 'table',
      schema: {
        version: 1,
        columns: [
          { key: 'value', label: 'value', type: 'string' },
          { key: 'label', label: 'label', type: 'string', nullable: true },
          { key: 'raw_json', label: 'raw', type: 'string', hidden: true, nullable: true },
        ],
      },
      data: {
        rows: [
          {
            id: '0',
            values: {
              value: 'component',
              label: 'component',
              raw_json: JSON.stringify({ value: 'component', label: 'component' }),
            },
          },
          {
            id: '1',
            values: {
              value: 'source',
              label: 'source',
              raw_json: JSON.stringify({ value: 'source', label: 'source' }),
            },
          },
        ],
      },
    });
  });

  it('loads style spec entries from R2 when reading component-editor schema definitions', async () => {
    const backend: LayoutBackend = {
      async list() {
        return { objects: [], truncated: false };
      },
      async getText(key: string) {
        if (key === 'style/padding.json') {
          return JSON.stringify([
            { key: 't', label: 't', target: 'paddingTop' },
            { key: 'r', label: 'r', target: 'paddingRight' },
            { key: 'b', label: 'b', target: 'paddingBottom' },
            { key: 'l', label: 'l', target: 'paddingLeft' },
          ]);
        }
        if (key === 'style/margin.json') {
          return JSON.stringify([
            { key: 't', label: 't', target: 'marginTop' },
            { key: 'r', label: 'r', target: 'marginRight' },
            { key: 'b', label: 'b', target: 'marginBottom' },
            { key: 'l', label: 'l', target: 'marginLeft' },
          ]);
        }
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
      {
        kind: 'style',
        key: 'padding',
        label: 'padding',
        entries: [
          { key: 't', label: 't', target: 'paddingTop' },
          { key: 'r', label: 'r', target: 'paddingRight' },
          { key: 'b', label: 'b', target: 'paddingBottom' },
          { key: 'l', label: 'l', target: 'paddingLeft' },
        ],
      },
      {
        kind: 'style',
        key: 'margin',
        label: 'margin',
        entries: [
          { key: 't', label: 't', target: 'marginTop' },
          { key: 'r', label: 'r', target: 'marginRight' },
          { key: 'b', label: 'b', target: 'marginBottom' },
          { key: 'l', label: 'l', target: 'marginLeft' },
        ],
      },
    ]);
  });
});
