import {
  COMPONENT_KINDS,
  type SchemaField,
  normalizeFormFieldKind,
} from '../schema/component';
import { STYLE_MAP_KEYS } from '../schema/component/style';
import type { TableData, TableSchema } from '../schema/component/kind/table';
import { editorSchema } from '../editor/component-editor';
import {
  schemaEditorTableDataToSchema,
  schemaEditorSchemaToTableData,
  validateSchemaEditorTableDraft,
} from '../schema/component/schema-editor';
import type { LayoutBackend } from '../storage/layouts/r2';
import {
  STYLE_SPEC_EDITABLE_KINDS,
  isStyleSpecKind,
  handleStyleSpecGet,
  handleStyleSpecPut,
} from './style-specs';

const COMPONENT_SCHEMA_KINDS = [...COMPONENT_KINDS, 'component-editor', 'screen'];
const SCHEMA_EDITABLE_KINDS = [...COMPONENT_SCHEMA_KINDS, ...STYLE_SPEC_EDITABLE_KINDS];
const STYLE_PROP_SCHEMA_KINDS: string[] = [...STYLE_MAP_KEYS];

const isStylePropKind = (kind: string): boolean => STYLE_PROP_SCHEMA_KINDS.includes(kind);

const FORM_FIELD_KIND_OPTIONS = [
  'text',
  'number',
  'textarea',
  'boolean',
  'select',
  'style',
  'object-list',
  'group',
].map((k) => ({ value: k, label: k }));

const migrateSchemaField = (field: SchemaField): SchemaField => {
  const nestedFields = Array.isArray(field.fields) ? field.fields.map(migrateSchemaField) : undefined;
  const kind = normalizeFormFieldKind(String(field.kind));

  if (kind === 'style') {
    const styleSpecKey = (field as Record<string, unknown>).styleSpecKey;
    const key = typeof styleSpecKey === 'string' && styleSpecKey
      ? styleSpecKey
      : (typeof field.key === 'string' && field.key !== 'style' ? field.key : 'padding');
    const result: SchemaField = { kind: 'style', key, label: field.label ?? key };
    if (nestedFields) result.fields = nestedFields;
    return result;
  }

  if (kind === 'text' && field.key === 'padding') {
    return { kind: 'style', key: 'padding', label: field.label ?? 'padding' };
  }

  return {
    ...field,
    kind,
    ...(nestedFields ? { fields: nestedFields } : {}),
  };
};

const migrateSchema = (schema: SchemaField[]): SchemaField[] => schema.map(migrateSchemaField);

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
      if (Array.isArray(parsed)) return migrateSchema(parsed as SchemaField[]);
      if (isTableDataLike(parsed)) return migrateSchema(schemaEditorTableDataToSchema(parsed));
    } catch {
      // fall through to defaults
    }
  }
  if (kind === 'component-editor') return editorSchema as SchemaField[];
  return [];
};

export const handleComponentSchemasList = (searchParams?: URLSearchParams): Response => {
  const category = searchParams?.get('category');
  let kinds: string[];
  if (category === 'component') {
    kinds = COMPONENT_SCHEMA_KINDS;
  } else if (category === 'style') {
    kinds = STYLE_PROP_SCHEMA_KINDS;
  } else {
    kinds = SCHEMA_EDITABLE_KINDS;
  }
  return new Response(
    JSON.stringify({ items: kinds.map((k) => ({ value: k, label: k })) }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};

export const handleComponentSchemaDefinitionGet = async (
  backend: LayoutBackend,
  kind: string,
): Promise<Response> => {
  if (!SCHEMA_EDITABLE_KINDS.includes(kind) && !isStylePropKind(kind)) return new Response('Not Found', { status: 404 });
  const schema = await loadStoredSchema(backend, kind);
  return new Response(JSON.stringify(schema), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const handleComponentSchemaGet = async (
  backend: LayoutBackend,
  kind: string,
): Promise<Response> => {
  if (!SCHEMA_EDITABLE_KINDS.includes(kind) && !isStylePropKind(kind)) return new Response('Not Found', { status: 404 });
  if (isStyleSpecKind(kind)) return handleStyleSpecGet(backend, kind);
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
  if (!SCHEMA_EDITABLE_KINDS.includes(kind) && !isStylePropKind(kind)) return new Response('Not Found', { status: 404 });
  if (isStyleSpecKind(kind)) return handleStyleSpecPut(request, backend, kind);

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
    schema = migrateSchema(rawData as SchemaField[]);
  } else if (isTableDataLike(rawData)) {
    schema = migrateSchema(schemaEditorTableDataToSchema(rawData));
  }

  if (!schema) return new Response('Bad Request', { status: 400 });

  await backend.putText(`schemas/${kind}.json`, JSON.stringify(schema));
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
