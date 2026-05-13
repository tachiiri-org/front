import {
  COMPONENT_KINDS,
  type SchemaField,
  normalizeFormFieldKind,
} from '../schema/component';
import { CSS_PROP_KEYS } from '../schema/component/style';
import { resolveStyleFieldEntries } from '../schema/component/style/specs';
import type { StyleEntrySpec } from '../schema/component/style/types';
import type { TableData, TableSchema } from '../schema/component/kind/table';
import { editorSchema } from '../editor/component-editor';
import { sourceEndpointSchema, sourceListSchema } from '../schema/source';
import {
  schemaEditorTableDataToSchema,
  schemaEditorSchemaToTableData,
  validateSchemaEditorTableDraft,
} from '../schema/component/schema-editor';
import type { LayoutBackend } from '../storage/layouts/r2';

const COMPONENT_SCHEMA_KINDS = [...COMPONENT_KINDS, 'component-editor', 'screen'];
const SOURCE_SCHEMA_KINDS = ['source/endpoint', 'source/list'];
const LIST_SCHEMA_KINDS = ['list/category'];
const SCHEMA_EDITABLE_KINDS = [...COMPONENT_SCHEMA_KINDS, ...SOURCE_SCHEMA_KINDS, ...LIST_SCHEMA_KINDS];
const CSS_PROP_SCHEMA_KINDS: string[] = [...CSS_PROP_KEYS];

const isStyleKind = (kind: string): boolean => CSS_PROP_SCHEMA_KINDS.includes(kind);
const isScreenKind = (kind: string): boolean => kind === 'screen';

const getSchemaStoragePath = (kind: string): string => {
  if (isStyleKind(kind)) return `style/${kind}.json`;
  if (isScreenKind(kind)) return `screen/${kind}.json`;
  if (kind.startsWith('list/')) return `${kind}.json`;
  if (kind.startsWith('source/')) return `${kind}.json`;
  return `component/${kind}.json`;
};

const getLegacySchemaStoragePath = (kind: string): string => `schemas/${kind}.json`;

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

export const STYLE_TABLE_SCHEMA: TableSchema = {
  version: 1,
  columns: [
    { key: 'key', label: 'key', type: 'string' },
    { key: 'label', label: 'label', type: 'string', nullable: true },
    { key: 'target', label: 'target', type: 'string' },
    { key: 'placeholder', label: 'placeholder', type: 'string', nullable: true },
    { key: 'defaultValue', label: 'defaultValue', type: 'string', nullable: true },
    { key: 'raw_json', label: 'raw', type: 'string', hidden: true, nullable: true },
  ],
};

export const LIST_TABLE_SCHEMA: TableSchema = {
  version: 1,
  columns: [
    { key: 'value', label: 'value', type: 'string' },
    { key: 'label', label: 'label', type: 'string', nullable: true },
    { key: 'raw_json', label: 'raw', type: 'string', hidden: true, nullable: true },
  ],
};

const LIST_SCHEMA_DEFINITION: SchemaField[] = [
  {
    kind: 'object-list',
    key: 'items',
    label: 'items',
    fields: [
      { kind: 'text', key: 'value', label: 'value' },
      { kind: 'text', key: 'label', label: 'label' },
    ],
  },
];

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const isTableDataLike = (value: unknown): value is TableData => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return Array.isArray(c.rows);
};

const isStyleEntrySpec = (value: unknown): value is StyleEntrySpec => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.key === 'string' &&
    (c.label === undefined || typeof c.label === 'string') &&
    (typeof c.target === 'string' ||
      (Array.isArray(c.target) && c.target.every((target) => typeof target === 'string'))) &&
    (c.placeholder === undefined || typeof c.placeholder === 'string') &&
    (c.defaultValue === undefined || typeof c.defaultValue === 'string')
  );
};

const isListEntrySpec = (value: unknown): value is { value: string; label?: string } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return typeof c.value === 'string' && (c.label === undefined || typeof c.label === 'string');
};

const migrateSchemaField = (field: SchemaField): SchemaField => {
  const nestedFields = Array.isArray(field.fields) ? field.fields.map(migrateSchemaField) : undefined;
  const kind = normalizeFormFieldKind(String(field.kind));

  if (kind === 'style') {
    const styleSpecKey = (field as Record<string, unknown>).styleSpecKey;
    const key = typeof styleSpecKey === 'string' && styleSpecKey
      ? styleSpecKey
      : (typeof field.key === 'string' && field.key !== 'style' ? field.key : 'padding');
    const result: SchemaField = { kind: 'style', key, label: field.label ?? key };
    if (typeof styleSpecKey === 'string' && styleSpecKey) result.styleSpecKey = styleSpecKey;
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

const listEntryToRow = (
  entry: { value: string; label?: string },
  index: number,
): { id: string; values: Record<string, unknown> } => ({
  id: String(index),
  values: {
    value: entry.value,
    label: entry.label ?? '',
    raw_json: JSON.stringify(entry),
  },
});

const listEntriesTableDataToSpec = (draft: TableData): Array<{ value: string; label?: string }> =>
  draft.rows.map((row) => {
    const raw = parseJson(row.values.raw_json);
    const base: Record<string, unknown> =
      isListEntrySpec(raw) ? { ...raw } : (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {});

    if (typeof row.values.value === 'string' && row.values.value.trim()) base.value = row.values.value.trim();
    if (typeof row.values.label === 'string' && row.values.label.trim()) base.label = row.values.label;
    return base as { value: string; label?: string };
  });

const validateListEntriesTableDraft = (draft: unknown): string | null => {
  if (!isTableDataLike(draft)) return 'Invalid list table data.';

  const keys = new Set<string>();
  for (const row of draft.rows) {
    const value = typeof row.values.value === 'string' ? row.values.value.trim() : '';
    if (!value) return `List entry value is required: ${row.id}`;
    if (keys.has(value)) return `Duplicate list entry value: ${value}`;
    keys.add(value);

    const rawJson = row.values.raw_json;
    if (typeof rawJson === 'string' && rawJson.trim() !== '' && parseJson(rawJson) === undefined) {
      return `Invalid raw JSON: ${value}`;
    }
  }

  return null;
};

const resolveSchemaField = async (backend: LayoutBackend, field: SchemaField): Promise<SchemaField> => {
  const nestedFields = Array.isArray(field.fields)
    ? await Promise.all(field.fields.map((subField) => resolveSchemaField(backend, subField)))
    : undefined;
  const kind = normalizeFormFieldKind(String(field.kind));

  if (kind === 'style') {
    const styleSpecKey = (field as Record<string, unknown>).styleSpecKey;
    const result: SchemaField = { ...field };
    if (nestedFields) result.fields = nestedFields;
    if (typeof styleSpecKey === 'string' && styleSpecKey) {
      const entries = await loadStoredStyleSpec(backend, styleSpecKey);
      if (entries) result.entries = entries;
    }
    delete result.styleSpecKey;
    return result;
  }

  return {
    ...field,
    ...(nestedFields ? { fields: nestedFields } : {}),
  };
};

const resolveSchema = async (backend: LayoutBackend, schema: SchemaField[]): Promise<SchemaField[]> =>
  Promise.all(schema.map((field) => resolveSchemaField(backend, field)));

const styleEntryToRow = (
  entry: StyleEntrySpec,
  index: number,
): { id: string; values: Record<string, unknown> } => ({
  id: String(index),
  values: {
    key: entry.key,
    label: entry.label ?? '',
    target: typeof entry.target === 'string' ? entry.target : JSON.stringify(entry.target),
    placeholder: entry.placeholder ?? '',
    defaultValue: entry.defaultValue ?? '',
    raw_json: JSON.stringify(entry),
  },
});

const styleEntriesTableDataToSpec = (draft: TableData): StyleEntrySpec[] =>
  draft.rows.map((row) => {
    const raw = parseJson(row.values.raw_json);
    const base: Record<string, unknown> =
      isStyleEntrySpec(raw) ? { ...raw } : (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {});

    if (typeof row.values.key === 'string' && row.values.key.trim()) base.key = row.values.key.trim();
    if (typeof row.values.label === 'string') base.label = row.values.label;

    const targetValue = typeof row.values.target === 'string' ? row.values.target.trim() : '';
    const parsedTarget = parseJson(targetValue);
    if (typeof parsedTarget === 'string' || (Array.isArray(parsedTarget) && parsedTarget.every((t) => typeof t === 'string'))) {
      base.target = parsedTarget;
    } else if (targetValue) {
      base.target = targetValue;
    }

    if (typeof row.values.placeholder === 'string' && row.values.placeholder.trim()) {
      base.placeholder = row.values.placeholder;
    }
    if (typeof row.values.defaultValue === 'string' && row.values.defaultValue.trim()) {
      base.defaultValue = row.values.defaultValue;
    }
    return base as StyleEntrySpec;
  });

const validateStyleEntriesTableDraft = (draft: unknown): string | null => {
  if (!isTableDataLike(draft)) return 'Invalid style table data.';

  const keys = new Set<string>();
  for (const row of draft.rows) {
    const key = typeof row.values.key === 'string' ? row.values.key.trim() : '';
    if (!key) return `Style entry key is required: ${row.id}`;
    if (keys.has(key)) return `Duplicate style entry key: ${key}`;
    keys.add(key);

    const target = typeof row.values.target === 'string' ? row.values.target.trim() : '';
    if (!target) return `Style entry target is required: ${key}`;
    const parsedTarget = parseJson(target);
    if (
      parsedTarget !== undefined &&
      typeof parsedTarget !== 'string' &&
      !(Array.isArray(parsedTarget) && parsedTarget.every((t) => typeof t === 'string'))
    ) {
      return `Invalid style entry target: ${key}`;
    }

    const rawJson = row.values.raw_json;
    if (typeof rawJson === 'string' && rawJson.trim() !== '' && parseJson(rawJson) === undefined) {
      return `Invalid raw JSON: ${key}`;
    }
  }

  return null;
};

const loadStoredComponentSchema = async (backend: LayoutBackend, kind: string): Promise<SchemaField[]> => {
  let stored = await backend.getText(getSchemaStoragePath(kind));
  if (!stored) stored = await backend.getText(getLegacySchemaStoragePath(kind));
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
  if (kind === 'source/endpoint') return sourceEndpointSchema as SchemaField[];
  if (kind === 'source/list') return sourceListSchema as SchemaField[];
  return [];
};

const loadStoredListEntries = async (
  backend: LayoutBackend,
  kind: string,
): Promise<Array<{ value: string; label?: string }>> => {
  let stored = await backend.getText(getSchemaStoragePath(kind));
  if (!stored) stored = await backend.getText(getLegacySchemaStoragePath(kind));
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed) && parsed.every(isListEntrySpec)) return parsed;
    } catch {
      // fall through to defaults
    }
  }
  return [];
};

const loadStoredStyleSpec = async (backend: LayoutBackend, kind: string): Promise<StyleEntrySpec[]> => {
  let stored = await backend.getText(getSchemaStoragePath(kind));
  if (!stored) stored = await backend.getText(getLegacySchemaStoragePath(kind));
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed) && parsed.every(isStyleEntrySpec)) return parsed;
    } catch {
      // fall through to defaults
    }
  }
  return resolveStyleFieldEntries(kind) ?? [];
};

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

export const handleComponentSchemasList = (searchParams?: URLSearchParams): Response => {
  const category = searchParams?.get('category');
  let kinds: string[];
  if (category === 'component') {
    kinds = COMPONENT_SCHEMA_KINDS;
  } else if (category === 'source') {
    kinds = SOURCE_SCHEMA_KINDS;
  } else if (category === 'endpoint') {
    kinds = ['source/endpoint'];
  } else if (category === 'list') {
    kinds = LIST_SCHEMA_KINDS;
  } else if (category === 'style') {
    kinds = CSS_PROP_SCHEMA_KINDS;
  } else {
    kinds = [...SCHEMA_EDITABLE_KINDS, ...CSS_PROP_SCHEMA_KINDS];
  }
  const labelForKind = (kind: string): string => {
    if (kind.startsWith('list/')) return kind.slice('list/'.length);
    if (kind.startsWith('source/')) return kind.slice('source/'.length);
    return kind;
  };
  return new Response(
    JSON.stringify({ items: kinds.map((k) => ({ value: k, label: labelForKind(k) })) }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};

export const handleComponentSchemaDefinitionGet = async (
  backend: LayoutBackend,
  kind: string,
): Promise<Response> => {
  if (!SCHEMA_EDITABLE_KINDS.includes(kind) && !isStyleKind(kind)) return new Response('Not Found', { status: 404 });
  if (isStyleKind(kind)) {
    return new Response(JSON.stringify(await loadStoredStyleSpec(backend, kind)), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (kind.startsWith('list/')) {
    return new Response(JSON.stringify(LIST_SCHEMA_DEFINITION), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const schema = await resolveSchema(backend, await loadStoredComponentSchema(backend, kind));
  return new Response(JSON.stringify(schema), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const handleComponentSchemaGet = async (
  backend: LayoutBackend,
  kind: string,
): Promise<Response> => {
  if (!SCHEMA_EDITABLE_KINDS.includes(kind) && !isStyleKind(kind)) return new Response('Not Found', { status: 404 });
  if (isStyleKind(kind)) {
    const spec = await loadStoredStyleSpec(backend, kind);
    return new Response(
      JSON.stringify({ kind: 'table', schema: STYLE_TABLE_SCHEMA, data: { rows: spec.map(styleEntryToRow) } }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (kind.startsWith('list/')) {
    const spec = await loadStoredListEntries(backend, kind);
    return new Response(
      JSON.stringify({ kind: 'table', schema: LIST_TABLE_SCHEMA, data: { rows: spec.map(listEntryToRow) } }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }
  const data = schemaEditorSchemaToTableData(await loadStoredComponentSchema(backend, kind));

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
  if (!SCHEMA_EDITABLE_KINDS.includes(kind) && !isStyleKind(kind)) return new Response('Not Found', { status: 404 });

  const body = (await request.json()) as unknown;
  const rawData =
    typeof body === 'object' && body !== null && 'data' in body
      ? (body as Record<string, unknown>).data
      : body;

  if (isStyleKind(kind)) {
    if (isTableDataLike(rawData)) {
      const message = validateStyleEntriesTableDraft(rawData);
      if (message) return new Response(message, { status: 400 });
    }

    let spec: StyleEntrySpec[] | null = null;
    if (Array.isArray(rawData)) {
      spec = rawData.every(isStyleEntrySpec) ? (rawData as StyleEntrySpec[]) : null;
    } else if (isTableDataLike(rawData)) {
      spec = styleEntriesTableDataToSpec(rawData);
    }

    if (!spec) return new Response('Bad Request', { status: 400 });

    await backend.putText(getSchemaStoragePath(kind), JSON.stringify(spec));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (kind.startsWith('list/')) {
    if (isTableDataLike(rawData)) {
      const message = validateListEntriesTableDraft(rawData);
      if (message) return new Response(message, { status: 400 });
    }

    let spec: Array<{ value: string; label?: string }> | null = null;
    if (Array.isArray(rawData)) {
      spec = rawData.every(isListEntrySpec) ? (rawData as Array<{ value: string; label?: string }>) : null;
    } else if (isTableDataLike(rawData)) {
      spec = listEntriesTableDataToSpec(rawData);
    }

    if (!spec) return new Response('Bad Request', { status: 400 });

    await backend.putText(getSchemaStoragePath(kind), JSON.stringify(spec));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (kind.startsWith('list/')) {
    if (isTableDataLike(rawData)) {
      const message = validateListEntriesTableDraft(rawData);
      if (message) return new Response(message, { status: 400 });
    }

    let spec: Array<{ value: string; label?: string }> | null = null;
    if (Array.isArray(rawData)) {
      spec = rawData.every(isListEntrySpec) ? (rawData as Array<{ value: string; label?: string }>) : null;
    } else if (isTableDataLike(rawData)) {
      spec = listEntriesTableDataToSpec(rawData);
    }

    if (!spec) return new Response('Bad Request', { status: 400 });

    await backend.putText(getSchemaStoragePath(kind), JSON.stringify(spec));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

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

  await backend.putText(getSchemaStoragePath(kind), JSON.stringify(schema));
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
