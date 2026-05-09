import { isTableData, isTableSchema, type TableSchema } from '../../../schema/component';
import { renderJsonEditorRow } from './json-editor';

export const validateTableDataDraft = (draft: unknown, schema: TableSchema): string | null => {
  if (!isTableData(draft)) return 'Invalid table data.';
  const rowIds = new Set<string>();
  const columns = schema.columns;

  for (const row of draft.rows) {
    if (rowIds.has(row.id)) return `Duplicate row id: ${row.id}`;
    rowIds.add(row.id);

    for (const column of columns) {
      const value = row.values[column.key];
      if (value === undefined || value === '') {
        if (column.required) return `Missing required value: ${column.label}`;
        if (!column.nullable) return `Missing value: ${column.label}`;
        continue;
      }

      if (value === null) {
        if (column.required || !column.nullable) return `Missing value: ${column.label}`;
        continue;
      }

      switch (column.type) {
        case 'string':
          if (typeof value !== 'string') return `Invalid string value: ${column.label}`;
          if (column.minLength !== undefined && value.length < column.minLength) {
            return `String too short: ${column.label}`;
          }
          if (column.maxLength !== undefined && value.length > column.maxLength) {
            return `String too long: ${column.label}`;
          }
          break;
        case 'int':
          if (typeof value !== 'number' || !Number.isInteger(value)) {
            return `Invalid int value: ${column.label}`;
          }
          if (column.min !== undefined && value < column.min) {
            return `Int too small: ${column.label}`;
          }
          if (column.max !== undefined && value > column.max) {
            return `Int too large: ${column.label}`;
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean') return `Invalid boolean value: ${column.label}`;
          break;
        case 'date':
          if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
            return `Invalid date value: ${column.label}`;
          }
          if (column.min !== undefined && Date.parse(value) < Date.parse(column.min)) {
            return `Date too early: ${column.label}`;
          }
          if (column.max !== undefined && Date.parse(value) > Date.parse(column.max)) {
            return `Date too late: ${column.label}`;
          }
          break;
        case 'select':
          if (typeof value !== 'string') return `Invalid select value: ${column.label}`;
          if (column.source.kind === 'inline') {
            const allowed = new Set(column.source.options.map((option) => option.value));
            if (!allowed.has(value)) return `Invalid select value: ${column.label}`;
          }
          break;
      }
    }
  }

  return null;
};

export const renderTableDataContent = (
  componentData: Record<string, unknown>,
  onSave: (patch: Record<string, unknown>) => Promise<void>,
): HTMLElement =>
  renderJsonEditorRow(
    'data',
    componentData.data ?? { rows: [] },
    (draft) => {
      if (!isTableData(draft)) return 'Invalid table data.';
      const schemaDraft = componentData.schema;
      if (!isTableSchema(schemaDraft)) return 'Invalid table schema.';
      return validateTableDataDraft(draft, schemaDraft);
    },
    async (draft) => {
      await onSave({ data: draft });
    },
  );
