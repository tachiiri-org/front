import {
  componentSchemas,
  COMPONENT_KINDS,
  type SchemaField,
} from '../schema/component';
import type { TableData, TableSchema } from '../schema/component/kind/table';
import {
  schemaEditorTableDataToSchema,
  schemaEditorSchemaToTableData,
  validateSchemaEditorTableDraft,
} from '../schema/component/schema-editor';
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

const isTableDataLike = (value: unknown): value is TableData => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return Array.isArray(c.rows);
};

const loadStoredSchema = async (backend: LayoutBackend, kind: string): Promise<SchemaField[]> => {
  const stored = await backend.getText(`schemas/${kind}.json`);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) return parsed as SchemaField[];
      if (isTableDataLike(parsed)) return schemaEditorTableDataToSchema(parsed);
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
  const data = schemaEditorSchemaToTableData(await loadStoredSchema(backend, kind));

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

  if (isTableDataLike(rawData)) {
    const message = validateSchemaEditorTableDraft(rawData);
    if (message) return new Response(message, { status: 400 });
  }

  let schema: SchemaField[] | null = null;
  if (Array.isArray(rawData)) {
    schema = rawData as SchemaField[];
  } else if (isTableDataLike(rawData)) {
    schema = schemaEditorTableDataToSchema(rawData);
  }

  if (!schema) return new Response('Bad Request', { status: 400 });

  await backend.putText(`schemas/${kind}.json`, JSON.stringify(schema));
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
