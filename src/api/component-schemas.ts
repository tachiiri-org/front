import {
  componentSchemas,
  COMPONENT_KINDS,
  isSchemaField,
  normalizeFormFieldKind,
  type SchemaField,
} from '../schema/component';
import type { TableData, TableSchema } from '../schema/component/kind/table';
import type { LayoutBackend } from '../storage/layouts/r2';

const FORM_FIELD_KIND_OPTIONS = [
  'text',
  'number',
  'textarea',
  'boolean',
  'select',
  'style-map',
  'object-list',
  'group',
].map((k) => ({ value: k, label: k }));

export const SCHEMA_TABLE_SCHEMA: TableSchema = {
  version: 1,
  columns: [
    { key: 'label', label: 'label', type: 'string', nullable: true },
    { key: 'key', label: 'key', type: 'string', nullable: true },
    {
      key: 'type',
      label: 'type',
      type: 'select',
      source: { kind: 'inline', options: FORM_FIELD_KIND_OPTIONS },
    },
    { key: 'options_json', label: 'options', type: 'string', hidden: true, nullable: true },
    { key: 'fields_json', label: 'fields', type: 'string', hidden: true, nullable: true },
    { key: 'style_json', label: 'style', type: 'string', hidden: true, nullable: true },
    { key: 'raw_json', label: 'raw', type: 'string', hidden: true, nullable: true },
  ],
};

const isSchemaFieldArray = (value: unknown): value is SchemaField[] =>
  Array.isArray(value) && value.every(isSchemaField);

const isTableDataLike = (value: unknown): value is TableData => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return Array.isArray(c.rows);
};

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const fieldToRow = (
  field: SchemaField,
  index: number,
): { id: string; values: Record<string, unknown> } => {
  const f = field as Record<string, unknown>;
  return {
    id: String(index),
    values: {
      type: normalizeFormFieldKind(String(field.kind)),
      key: typeof f.key === 'string' ? f.key : '',
      label: typeof f.label === 'string' ? f.label : '',
      options_json: Array.isArray(f.options) ? JSON.stringify(f.options) : '',
      fields_json: Array.isArray(f.fields) ? JSON.stringify(f.fields) : '',
      style_json:
        typeof f.style === 'object' && f.style !== null ? JSON.stringify(f.style) : '',
      raw_json: JSON.stringify(field),
    },
  };
};

const rowToSchemaField = (row: TableData['rows'][number]): SchemaField => {
  const raw = parseJson(row.values.raw_json);
  const base: Record<string, unknown> =
    isSchemaField(raw) ? { ...raw } : (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {});
  if (typeof base.kind === 'string') base.kind = normalizeFormFieldKind(base.kind);

  const rowType =
    typeof row.values.type === 'string' && row.values.type.trim()
      ? row.values.type
      : typeof row.values.kind === 'string' && row.values.kind.trim()
        ? row.values.kind
        : '';
  if (rowType) base.kind = normalizeFormFieldKind(rowType);
  if (typeof row.values.key === 'string' && row.values.key.trim()) base.key = row.values.key;
  if (typeof row.values.label === 'string') base.label = row.values.label;

  const options = parseJson(row.values.options_json);
  if (Array.isArray(options)) base.options = options;

  const fields = parseJson(row.values.fields_json);
  if (isSchemaFieldArray(fields)) base.fields = fields;

  const style = parseJson(row.values.style_json);
  if (style && typeof style === 'object' && !Array.isArray(style)) {
    base.style = style;
  }

  return base as SchemaField;
};

const tableDataToSchema = (data: TableData): SchemaField[] => data.rows.map(rowToSchemaField);

const schemaToTableData = (schema: SchemaField[]): TableData => ({
  rows: schema.map((field, i) => fieldToRow(field, i)),
});

const loadStoredSchema = async (backend: LayoutBackend, kind: string): Promise<SchemaField[]> => {
  const stored = await backend.getText(`schemas/${kind}.json`);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (isSchemaFieldArray(parsed)) return parsed;
      if (isTableDataLike(parsed)) return tableDataToSchema(parsed);
    } catch {
      // fall through to defaults
    }
  }
  return componentSchemas[kind] ?? [];
};

export const handleComponentSchemasList = (): Response =>
  new Response(
    JSON.stringify({ items: COMPONENT_KINDS.map((k) => ({ value: k, label: k })) }),
    { headers: { 'Content-Type': 'application/json' } },
  );

export const handleComponentSchemaDefinitionGet = async (
  backend: LayoutBackend,
  kind: string,
): Promise<Response> => {
  if (!COMPONENT_KINDS.includes(kind)) return new Response('Not Found', { status: 404 });
  const schema = await loadStoredSchema(backend, kind);
  return new Response(JSON.stringify(schema), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const handleComponentSchemaGet = async (
  backend: LayoutBackend,
  kind: string,
): Promise<Response> => {
  if (!COMPONENT_KINDS.includes(kind)) return new Response('Not Found', { status: 404 });
  const data = schemaToTableData(await loadStoredSchema(backend, kind));

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
  const rawData =
    typeof body === 'object' && body !== null && 'data' in body
      ? (body as Record<string, unknown>).data
      : body;

  let schema: SchemaField[] | null = null;
  if (isSchemaFieldArray(rawData)) {
    schema = rawData;
  } else if (isTableDataLike(rawData)) {
    schema = tableDataToSchema(rawData);
  }

  if (!schema) return new Response('Bad Request', { status: 400 });

  await backend.putText(`schemas/${kind}.json`, JSON.stringify(schema));
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
