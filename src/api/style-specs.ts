import { STYLE_SPECS, STYLE_SPEC_KEYS } from '../schema/component/style';
import type { StyleEntrySpec } from '../schema/component/style';
import { isTableData, type TableData, type TableSchema } from '../schema/component/kind/table';
import type { LayoutBackend } from '../storage/layouts/r2';

export const STYLE_SPEC_KIND_PREFIX = 'style/';

export const STYLE_SPEC_EDITABLE_KINDS: string[] = STYLE_SPEC_KEYS.map(
  (k) => `${STYLE_SPEC_KIND_PREFIX}${k}`,
);

export const isStyleSpecKind = (kind: string): boolean =>
  kind.startsWith(STYLE_SPEC_KIND_PREFIX) &&
  STYLE_SPEC_KEYS.includes(kind.slice(STYLE_SPEC_KIND_PREFIX.length));

export const STYLE_SPEC_TABLE_SCHEMA: TableSchema = {
  version: 1,
  columns: [
    { key: 'key', label: 'key', type: 'string' },
    { key: 'label', label: 'label', type: 'string', nullable: true },
    { key: 'target', label: 'target', type: 'string' },
    { key: 'placeholder', label: 'placeholder', type: 'string', nullable: true },
    { key: 'defaultValue', label: 'defaultValue', type: 'string', nullable: true },
  ],
};

const entryToRow = (
  entry: StyleEntrySpec,
  index: number,
): { id: string; values: Record<string, unknown> } => ({
  id: String(index),
  values: {
    key: entry.key,
    label: entry.label ?? '',
    target: Array.isArray(entry.target) ? JSON.stringify(entry.target) : entry.target,
    placeholder: entry.placeholder ?? '',
    defaultValue: entry.defaultValue ?? '',
  },
});

const parseTarget = (raw: string): string | string[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return parsed as string[];
    }
  } catch {
    // use raw string
  }
  return raw;
};

const rowToEntry = (row: { id: string; values: Record<string, unknown> }): StyleEntrySpec => {
  const key = typeof row.values.key === 'string' ? row.values.key.trim() : '';
  const label = typeof row.values.label === 'string' ? row.values.label.trim() : '';
  const targetRaw = typeof row.values.target === 'string' ? row.values.target.trim() : '';
  const placeholder = typeof row.values.placeholder === 'string' ? row.values.placeholder.trim() : '';
  const defaultValue = typeof row.values.defaultValue === 'string' ? row.values.defaultValue.trim() : '';

  return {
    key,
    ...(label ? { label } : {}),
    target: parseTarget(targetRaw),
    ...(placeholder ? { placeholder } : {}),
    ...(defaultValue ? { defaultValue } : {}),
  };
};

const specKeyFromKind = (kind: string): string => kind.slice(STYLE_SPEC_KIND_PREFIX.length);

const loadStoredEntries = async (
  backend: LayoutBackend,
  specKey: string,
): Promise<StyleEntrySpec[]> => {
  const stored = await backend.getText(`style-specs/${specKey}.json`);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) return parsed as StyleEntrySpec[];
    } catch {
      // fall through to defaults
    }
  }
  return STYLE_SPECS[specKey]?.entries ?? [];
};

export const handleStyleSpecGet = async (
  backend: LayoutBackend,
  kind: string,
): Promise<Response> => {
  const specKey = specKeyFromKind(kind);
  const entries = await loadStoredEntries(backend, specKey);
  const data: TableData = { rows: entries.map((e, i) => entryToRow(e, i)) };
  return new Response(
    JSON.stringify({ kind: 'table', schema: STYLE_SPEC_TABLE_SCHEMA, data }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};

export const handleStyleSpecPut = async (
  request: Request,
  backend: LayoutBackend,
  kind: string,
): Promise<Response> => {
  const specKey = specKeyFromKind(kind);
  const body = (await request.json()) as unknown;
  const rawData =
    typeof body === 'object' && body !== null && 'data' in body
      ? (body as Record<string, unknown>).data
      : body;

  if (!isTableData(rawData)) return new Response('Bad Request', { status: 400 });

  const entries = rawData.rows
    .filter((row) => typeof row.values.key === 'string' && (row.values.key as string).trim())
    .map(rowToEntry);

  await backend.putText(`style-specs/${specKey}.json`, JSON.stringify(entries));
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
