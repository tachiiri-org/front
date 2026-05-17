import {
  COMPONENT_KINDS,
  type SchemaField,
  normalizeFormFieldKind,
} from '../schema/component';
import { CSS_PROP_KEYS } from '../schema/component/style';
import { resolveStyleFieldEntries } from '../schema/component/style/specs';
import type { StyleEntrySpec } from '../schema/component/style/types';
import type { TableColumn, TableData, TableSchema } from '../schema/component/kind/table';
import { isTableColumn } from '../schema/component/kind/table';
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
const SCHEMA_EDITABLE_KINDS = [...COMPONENT_SCHEMA_KINDS, ...SOURCE_SCHEMA_KINDS];
const CSS_PROP_SCHEMA_KINDS: string[] = [...CSS_PROP_KEYS];

const isStyleKind = (kind: string): boolean => CSS_PROP_SCHEMA_KINDS.includes(kind);
const isListKind = (kind: string): boolean => kind.startsWith('list/');
const isColumnsKind = (kind: string): boolean => kind.startsWith('list/') && kind.endsWith('-columns');
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
    { key: 'childList', label: 'childList', type: 'string', nullable: true },
    { key: 'raw_json', label: 'raw', type: 'string', hidden: true, nullable: true },
  ],
};

const COLUMN_TYPE_OPTIONS = ['string', 'int', 'boolean', 'date', 'select'].map((k) => ({
  value: k,
  label: k,
}));

export const LIST_COLUMNS_TABLE_SCHEMA: TableSchema = {
  version: 1,
  columns: [
    { key: 'key', label: 'key', type: 'string' },
    { key: 'label', label: 'label', type: 'string', nullable: true },
    { key: 'type', label: 'type', type: 'select', source: { kind: 'inline', options: COLUMN_TYPE_OPTIONS } },
    { key: 'nullable', label: 'nullable', type: 'boolean', nullable: true },
    { key: 'hidden', label: 'hidden', type: 'boolean', nullable: true },
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

type ListEntry = { value: string; label?: string; childList?: string };

const isListEntrySpec = (value: unknown): value is ListEntry => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.value === 'string' &&
    (c.label === undefined || typeof c.label === 'string') &&
    (c.childList === undefined || typeof c.childList === 'string')
  );
};

const buildListTableSchema = (columns: TableColumn[]): TableSchema => ({
  version: 1,
  columns: [
    ...columns,
    { key: 'raw_json', label: 'raw', type: 'string', hidden: true, nullable: true },
  ],
});

const listGenericEntryToRow = (
  entry: Record<string, unknown>,
  columns: TableColumn[],
  index: number,
): { id: string; values: Record<string, unknown> } => ({
  id: String(index),
  values: {
    ...Object.fromEntries(columns.map((col) => [col.key, entry[col.key] ?? ''])),
    raw_json: JSON.stringify(entry),
  },
});

const listGenericRowsToEntries = (
  draft: TableData,
  columns: TableColumn[],
): Record<string, unknown>[] =>
  draft.rows.map((row) => {
    const raw = parseJson(row.values.raw_json);
    const base: Record<string, unknown> =
      typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {};
    for (const col of columns) {
      const v = row.values[col.key];
      if (typeof v === 'boolean') {
        base[col.key] = v;
      } else if (typeof v === 'number') {
        base[col.key] = v;
      } else if (typeof v === 'string' && v.trim()) {
        base[col.key] = v;
      } else {
        delete base[col.key];
      }
    }
    return base;
  });

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
  entry: ListEntry,
  index: number,
): { id: string; values: Record<string, unknown> } => ({
  id: String(index),
  values: {
    value: entry.value,
    label: entry.label ?? '',
    childList: entry.childList ?? '',
    raw_json: JSON.stringify(entry),
  },
});

const listEntriesTableDataToSpec = (draft: TableData): ListEntry[] =>
  draft.rows.map((row) => {
    const raw = parseJson(row.values.raw_json);
    const base: Record<string, unknown> =
      isListEntrySpec(raw) ? { ...raw } : (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {});

    if (typeof row.values.value === 'string' && row.values.value.trim()) base.value = row.values.value.trim();
    if (typeof row.values.label === 'string' && row.values.label.trim()) base.label = row.values.label;
    if (typeof row.values.childList === 'string' && row.values.childList.trim()) base.childList = row.values.childList.trim();
    else if ('childList' in row.values && !row.values.childList) delete base.childList;
    return base as ListEntry;
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

const treeNodesToColumns = (nodes: unknown[]): TableColumn[] =>
  (nodes as Record<string, unknown>[])
    .map((n) => (typeof n.text === 'string' ? n.text.trim() : ''))
    .filter(Boolean)
    .map((key) => ({ key, label: key, type: 'string' as const, nullable: true }));

const columnToRow = (col: TableColumn, i: number): { id: string; values: Record<string, unknown> } => ({
  id: String(i),
  values: {
    key: col.key,
    label: col.label ?? '',
    type: col.type,
    nullable: col.nullable ?? false,
    hidden: col.hidden ?? false,
  },
});

const VALID_COLUMN_TYPES = ['string', 'int', 'boolean', 'date', 'select'] as const;
type ValidColumnType = (typeof VALID_COLUMN_TYPES)[number];

const rowsToColumns = (draft: TableData): TableColumn[] => {
  const cols: TableColumn[] = [];
  for (const row of draft.rows) {
    const key = typeof row.values.key === 'string' ? row.values.key.trim() : '';
    if (!key) continue;
    const label = typeof row.values.label === 'string' && row.values.label.trim() ? row.values.label : key;
    const rawType = typeof row.values.type === 'string' ? row.values.type.trim() : '';
    const type: ValidColumnType = (VALID_COLUMN_TYPES as readonly string[]).includes(rawType)
      ? (rawType as ValidColumnType)
      : 'string';
    const nullable = typeof row.values.nullable === 'boolean' ? row.values.nullable : true;
    const hidden = typeof row.values.hidden === 'boolean' ? row.values.hidden : undefined;
    if (type === 'select') {
      cols.push({ key, label, type: 'select', source: { kind: 'inline', options: [] }, nullable, ...(hidden !== undefined ? { hidden } : {}) });
    } else {
      cols.push({ key, label, type, nullable, ...(hidden !== undefined ? { hidden } : {}) } as TableColumn);
    }
  }
  return cols;
};

const listEntriesToColumns = (entries: unknown[]): TableColumn[] =>
  (entries as Record<string, unknown>[]).flatMap((e) => {
    const key = typeof e.value === 'string' ? e.value.trim() : '';
    if (!key) return [];
    const label = typeof e.label === 'string' && e.label ? e.label : key;
    return [{ key, label, type: 'string' as const, nullable: true }];
  });

const loadStoredListColumns = async (
  backend: LayoutBackend,
  kind: string,
): Promise<TableColumn[] | null> => {
  // list/ storage takes priority (list-editor writes here)
  const listStored = await backend.getText(`${kind}-columns.json`);
  if (listStored) {
    try {
      const entries = JSON.parse(listStored) as unknown;
      if (Array.isArray(entries) && entries.length > 0) {
        if (entries.every(isTableColumn)) return entries as TableColumn[];
        return listEntriesToColumns(entries);
      }
    } catch {
      // fall through
    }
  }
  // trees/ storage fallback (tree-editor writes here)
  const treeStored = await backend.getText(`trees/${kind}-columns.json`);
  if (treeStored) {
    try {
      const treeData = JSON.parse(treeStored) as unknown;
      const nodes = (treeData as Record<string, unknown>)?.nodes;
      if (Array.isArray(nodes) && nodes.length > 0) return treeNodesToColumns(nodes);
    } catch {
      // fall through
    }
  }
  return null;
};

const loadStoredListRawItems = async (
  backend: LayoutBackend,
  kind: string,
): Promise<Record<string, unknown>[]> => {
  let stored = await backend.getText(getSchemaStoragePath(kind));
  if (!stored) stored = await backend.getText(getLegacySchemaStoragePath(kind));
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (i): i is Record<string, unknown> =>
            typeof i === 'object' && i !== null && !Array.isArray(i),
        );
      }
    } catch {
      // fall through
    }
  }
  if (kind === 'list/css-prop-keys') return CSS_PROP_KEYS.map((k) => ({ value: k }));
  // For -columns lists, fall back to trees/ storage (tree-editor writes there)
  if (kind.startsWith('list/') && kind.endsWith('-columns')) {
    const treeStored = await backend.getText(`trees/${kind}.json`);
    if (treeStored) {
      try {
        const treeData = JSON.parse(treeStored) as unknown;
        const nodes = (treeData as Record<string, unknown>)?.nodes;
        if (Array.isArray(nodes)) {
          return (nodes as Record<string, unknown>[])
            .map((n) => ({ value: typeof n.text === 'string' ? n.text.trim() : '' }))
            .filter((e) => Boolean(e.value));
        }
      } catch {
        // fall through
      }
    }
  }
  return [];
};

const loadStoredListEntries = async (
  backend: LayoutBackend,
  kind: string,
): Promise<ListEntry[]> => {
  const items = await loadStoredListRawItems(backend, kind);
  if (items.every(isListEntrySpec)) return items as ListEntry[];

  const columns = await loadStoredListColumns(backend, kind);
  if (columns && columns.length > 0) {
    const primaryKey = columns[0].key;
    return items.flatMap((item) => {
      const v = typeof item[primaryKey] === 'string' ? (item[primaryKey] as string) : '';
      if (!v) return [];
      const entry: ListEntry = { value: v };
      if (typeof item.label === 'string') entry.label = item.label;
      if (typeof item.childList === 'string') entry.childList = item.childList;
      return [entry];
    });
  }

  return items.filter(isListEntrySpec);
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

const listKindsFromBackend = async (backend: LayoutBackend): Promise<string[]> => {
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await backend.list('list/', cursor);
    for (const object of result.objects) {
      if (!object.key.endsWith('.json')) continue;
      const relative = object.key.slice('list/'.length);
      if (relative.includes('/')) continue;
      seen.add('list/' + relative.slice(0, -'.json'.length));
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  return [...seen].sort();
};

export const handleComponentSchemasList = async (
  backend: LayoutBackend,
  searchParams?: URLSearchParams,
): Promise<Response> => {
  const category = searchParams?.get('category');
  let kinds: string[];
  if (category === 'component') {
    kinds = COMPONENT_SCHEMA_KINDS;
  } else if (category === 'source') {
    kinds = SOURCE_SCHEMA_KINDS;
  } else if (category === 'endpoint') {
    kinds = ['source/endpoint'];
  } else if (category === 'list') {
    const listKinds = await listKindsFromBackend(backend);
    kinds = listKinds.flatMap((k) => (k.endsWith('-columns') ? [k] : [k, `${k}-columns`]));
  } else if (category === 'style') {
    kinds = CSS_PROP_SCHEMA_KINDS;
  } else {
    const listKinds = await listKindsFromBackend(backend);
    kinds = [...SCHEMA_EDITABLE_KINDS, ...listKinds.flatMap((k) => (k.endsWith('-columns') ? [k] : [k, `${k}-columns`])), ...CSS_PROP_SCHEMA_KINDS];
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

type TreeItem = { value: string; label: string; children: Array<{ value: string; label: string }> };

export const handleComponentSchemasTree = async (backend: LayoutBackend): Promise<Response> => {
  const navEntries = await loadStoredListEntries(backend, 'list/schema-nav');
  const items: TreeItem[] = await Promise.all(
    navEntries.map(async (entry) => {
      let children: Array<{ value: string; label: string }> = [];
      if (entry.childList) {
        const childEntries = await loadStoredListEntries(backend, `list/${entry.childList}`);
        children = childEntries.map((e) => ({ value: e.value, label: e.label ?? e.value }));
      } else {
        const kinds = await listKindsFromBackend(backend);
        children = kinds.flatMap((k) => {
          const label = k.startsWith('list/') ? k.slice('list/'.length) : k;
          if (k.endsWith('-columns')) return [{ value: k, label }];
          return [
            { value: k, label },
            { value: `${k}-columns`, label: `${label}-columns` },
          ];
        });
      }
      return { value: entry.value, label: entry.label ?? entry.value, children };
    }),
  );
  return new Response(JSON.stringify({ items }), { headers: { 'Content-Type': 'application/json' } });
};

export const handleComponentSchemaDefinitionGet = async (
  backend: LayoutBackend,
  kind: string,
): Promise<Response> => {
  if (!SCHEMA_EDITABLE_KINDS.includes(kind) && !isStyleKind(kind) && !isListKind(kind)) return new Response('Not Found', { status: 404 });
  if (isStyleKind(kind)) {
    return new Response(JSON.stringify(await loadStoredStyleSpec(backend, kind)), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (isListKind(kind)) {
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
  if (!SCHEMA_EDITABLE_KINDS.includes(kind) && !isStyleKind(kind) && !isListKind(kind)) return new Response('Not Found', { status: 404 });
  if (isStyleKind(kind)) {
    const spec = await loadStoredStyleSpec(backend, kind);
    return new Response(
      JSON.stringify({ kind: 'table', schema: STYLE_TABLE_SCHEMA, data: { rows: spec.map(styleEntryToRow) } }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (isColumnsKind(kind)) {
    let cols: TableColumn[] = [];
    // list/ storage: TableColumn[] saved by list-editor
    const stored = await backend.getText(getSchemaStoragePath(kind));
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed) && parsed.every(isTableColumn)) cols = parsed as TableColumn[];
      } catch { /* fall through */ }
    }
    // trees/ storage fallback: tree-editor nodes
    if (cols.length === 0) {
      const treeStored = await backend.getText(`trees/${kind}.json`);
      if (treeStored) {
        try {
          const treeData = JSON.parse(treeStored) as unknown;
          const nodes = (treeData as Record<string, unknown>)?.nodes;
          if (Array.isArray(nodes)) cols = treeNodesToColumns(nodes);
        } catch { /* fall through */ }
      }
    }
    const rows = cols.map(columnToRow);
    return new Response(
      JSON.stringify({ kind: 'table', schema: LIST_COLUMNS_TABLE_SCHEMA, data: { rows } }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (isListKind(kind)) {
    const [items, columns] = await Promise.all([
      loadStoredListRawItems(backend, kind),
      loadStoredListColumns(backend, kind),
    ]);
    if (columns) {
      const schema = buildListTableSchema(columns);
      const rows = items.map((item, i) => listGenericEntryToRow(item, columns, i));
      return new Response(
        JSON.stringify({ kind: 'table', schema, data: { rows } }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }
    const rows = items.filter(isListEntrySpec).map(listEntryToRow);
    return new Response(
      JSON.stringify({ kind: 'table', schema: LIST_TABLE_SCHEMA, data: { rows } }),
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
  if (!SCHEMA_EDITABLE_KINDS.includes(kind) && !isStyleKind(kind) && !isListKind(kind)) return new Response('Not Found', { status: 404 });

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

  if (isColumnsKind(kind)) {
    if (!isTableDataLike(rawData)) return new Response('Bad Request', { status: 400 });
    const keys = new Set<string>();
    for (const row of rawData.rows) {
      const key = typeof row.values.key === 'string' ? row.values.key.trim() : '';
      if (!key) return new Response(`Column key is required: ${row.id}`, { status: 400 });
      if (keys.has(key)) return new Response(`Duplicate column key: ${key}`, { status: 400 });
      keys.add(key);
    }
    const cols = rowsToColumns(rawData);
    await backend.putText(getSchemaStoragePath(kind), JSON.stringify(cols));
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (kind.startsWith('list/')) {
    const columns = await loadStoredListColumns(backend, kind);

    if (columns) {
      if (!isTableDataLike(rawData)) return new Response('Bad Request', { status: 400 });
      const primaryKey = columns[0].key;
      const seen = new Set<string>();
      for (const row of rawData.rows) {
        const v = typeof row.values[primaryKey] === 'string' ? String(row.values[primaryKey]).trim() : '';
        if (!v) return new Response(`Primary key "${primaryKey}" is required: ${row.id}`, { status: 400 });
        if (seen.has(v)) return new Response(`Duplicate primary key "${primaryKey}": ${v}`, { status: 400 });
        seen.add(v);
      }
      const items = listGenericRowsToEntries(rawData, columns);
      await backend.putText(getSchemaStoragePath(kind), JSON.stringify(items));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

