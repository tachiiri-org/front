import { isTableData, type TableData } from './kind/table';
import { isSchemaField, normalizeFormFieldKind, type SchemaField } from './kind/form/field';

const ALLOWED_FIELD_KINDS = new Set([
  'text',
  'number',
  'textarea',
  'boolean',
  'select',
  'style-map',
  'object-list',
  'group',
]);

const isSchemaFieldArray = (value: unknown): value is SchemaField[] =>
  Array.isArray(value) && value.every(isSchemaField);

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

export type SchemaEditorCellIssueMap = Record<string, string>;

export type SchemaEditorValidationDetail = {
  message: string | null;
  rowIssues: Map<string, SchemaEditorCellIssueMap>;
};

const fieldToRow = (
  field: unknown,
  index: number,
): { id: string; values: Record<string, unknown> } => {
  const f = typeof field === 'object' && field !== null && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : {};
  const kind = typeof f.kind === 'string' ? f.kind : '';
  return {
    id: String(index),
    values: {
      type: kind ? normalizeFormFieldKind(kind) : '',
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

export const validateSchemaEditorTableDraft = (draft: unknown): string | null => {
  return validateSchemaEditorTableDraftDetail(draft).message;
};

export const validateSchemaEditorTableDraftDetail = (draft: unknown): SchemaEditorValidationDetail => {
  if (!isTableData(draft)) {
    return { message: 'Invalid schema table data.', rowIssues: new Map() };
  }

  const keys = new Map<string, string>();
  const rowIssues = new Map<string, SchemaEditorCellIssueMap>();
  let message: string | null = null;

  const markIssue = (rowId: string, column: string, message: string): void => {
    const current = rowIssues.get(rowId) ?? {};
    current[column] = message;
    rowIssues.set(rowId, current);
  };

  const setMessage = (next: string): void => {
    if (message === null) message = next;
  };

  for (const row of draft.rows) {
    const type = typeof row.values.type === 'string' ? normalizeFormFieldKind(row.values.type).trim() : '';
    if (!type) {
      markIssue(row.id, 'type', 'Missing field type.');
      setMessage(`Missing field type: ${row.id}`);
      continue;
    }
    if (!ALLOWED_FIELD_KINDS.has(type)) {
      markIssue(row.id, 'type', `Invalid field type: ${type}`);
      setMessage(`Invalid field type: ${type}`);
      continue;
    }

    const key = typeof row.values.key === 'string' ? row.values.key.trim() : '';
    if (!key && type !== 'group') {
      markIssue(row.id, 'key', 'Field key is required.');
      setMessage(`Field key is required: ${row.id}`);
    }
    if (key && keys.has(key)) {
      const prevRowId = keys.get(key);
      if (prevRowId) {
        markIssue(prevRowId, 'key', `Duplicate field key: ${key}`);
      }
      markIssue(row.id, 'key', `Duplicate field key: ${key}`);
      setMessage(`Duplicate field key: ${key}`);
    } else if (key) {
      keys.set(key, row.id);
    }

    const rawJson = row.values.raw_json;
    if (typeof rawJson === 'string' && rawJson.trim() !== '') {
      const parsed = parseJson(rawJson);
      if (parsed === undefined) {
        markIssue(row.id, 'raw_json', 'Invalid raw JSON.');
        setMessage(`Invalid raw JSON: ${key || row.id}`);
      }
    }

    const optionsJson = row.values.options_json;
    if (typeof optionsJson === 'string' && optionsJson.trim() !== '') {
      const parsed = parseJson(optionsJson);
      if (!Array.isArray(parsed) || !parsed.every((item) =>
        typeof item === 'object' &&
        item !== null &&
        !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).value === 'string' &&
        typeof (item as Record<string, unknown>).label === 'string'
      )) {
        markIssue(row.id, 'options_json', 'Invalid options JSON.');
        setMessage(`Invalid options JSON: ${key || row.id}`);
      }
    }

    const fieldsJson = row.values.fields_json;
    if (typeof fieldsJson === 'string' && fieldsJson.trim() !== '') {
      const parsed = parseJson(fieldsJson);
      if (!isSchemaFieldArray(parsed)) {
        markIssue(row.id, 'fields_json', 'Invalid fields JSON.');
        setMessage(`Invalid fields JSON: ${key || row.id}`);
      }
    }

    const styleJson = row.values.style_json;
    if (typeof styleJson === 'string' && styleJson.trim() !== '') {
      const parsed = parseJson(styleJson);
      if (!isStringRecord(parsed)) {
        markIssue(row.id, 'style_json', 'Invalid style JSON.');
        setMessage(`Invalid style JSON: ${key || row.id}`);
      }
    }
  }

  return { message, rowIssues };
};

export const schemaEditorTableDataToSchema = (draft: TableData): SchemaField[] => {
  const rows = draft.rows;
  return rows.map((row) => {
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
    if (isStringRecord(style)) {
      base.style = style;
    }

    return base as SchemaField;
  });
};

export const schemaEditorSchemaToTableData = (schema: SchemaField[]): TableData => ({
  rows: schema.map((field, i) => fieldToRow(field, i)),
});
