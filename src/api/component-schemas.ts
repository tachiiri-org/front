import { componentSchemas, COMPONENT_KINDS } from '../schema/component';
import type { FormField } from '../schema/component/kind/form/field';
import type { TableData, TableSchema } from '../schema/component/kind/table';
import type { LayoutBackend } from '../storage/layouts/r2';

const FORM_FIELD_KIND_OPTIONS = [
  'text-field',
  'number-field',
  'textarea-field',
  'boolean-field',
  'select-field',
  'style-map-field',
  'object-list-field',
  'field-group',
].map((k) => ({ value: k, label: k }));

export const SCHEMA_TABLE_SCHEMA: TableSchema = {
  version: 1,
  columns: [
    {
      key: 'kind',
      label: 'kind',
      type: 'select',
      source: { kind: 'inline', options: FORM_FIELD_KIND_OPTIONS },
    },
    { key: 'key', label: 'key', type: 'string', nullable: true },
    { key: 'label', label: 'label', type: 'string', nullable: true },
    { key: 'options_json', label: 'options', type: 'string', nullable: true },
    { key: 'fields_json', label: 'fields', type: 'string', nullable: true },
    { key: 'style_json', label: 'style', type: 'string', nullable: true },
  ],
};

const fieldToRow = (
  field: FormField,
  index: number,
): { id: string; values: Record<string, unknown> } => {
  const f = field as Record<string, unknown>;
  return {
    id: String(index),
    values: {
      kind: field.kind,
      key: typeof f.key === 'string' ? f.key : '',
      label: typeof f.label === 'string' ? f.label : '',
      options_json: Array.isArray(f.options) ? JSON.stringify(f.options) : '',
      fields_json: Array.isArray(f.fields) ? JSON.stringify(f.fields) : '',
      style_json:
        typeof f.style === 'object' && f.style !== null ? JSON.stringify(f.style) : '',
    },
  };
};

const schemaToTableData = (schema: FormField[]): TableData => ({
  rows: schema.map((field, i) => fieldToRow(field, i)),
});

export const handleComponentSchemasList = (): Response =>
  new Response(
    JSON.stringify({ items: COMPONENT_KINDS.map((k) => ({ value: k, label: k })) }),
    { headers: { 'Content-Type': 'application/json' } },
  );

export const handleComponentSchemaGet = async (
  backend: LayoutBackend,
  kind: string,
): Promise<Response> => {
  if (!COMPONENT_KINDS.includes(kind)) return new Response('Not Found', { status: 404 });

  const stored = await backend.getText(`schemas/${kind}.json`);
  let data: TableData;
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      data =
        typeof parsed === 'object' &&
        parsed !== null &&
        'rows' in parsed &&
        Array.isArray((parsed as Record<string, unknown>).rows)
          ? (parsed as TableData)
          : schemaToTableData(componentSchemas[kind] ?? []);
    } catch {
      data = schemaToTableData(componentSchemas[kind] ?? []);
    }
  } else {
    data = schemaToTableData(componentSchemas[kind] ?? []);
  }

  return new Response(
    JSON.stringify({ kind: 'table', schema: SCHEMA_TABLE_SCHEMA, data }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};

export const handleComponentSchemaPut = async (
  request: Request,
  backend: LayoutBackend,
  kind: string,
): Promise<Response> => {
  if (!COMPONENT_KINDS.includes(kind)) return new Response('Not Found', { status: 404 });

  const body = (await request.json()) as unknown;
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    return new Response('Bad Request', { status: 400 });
  }

  await backend.putText(
    `schemas/${kind}.json`,
    JSON.stringify((body as Record<string, unknown>).data),
  );
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
