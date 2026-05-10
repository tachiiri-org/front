import type { SchemaField } from './form/field';
import { STYLE_SPEC_KEYS, isStyleRecord } from '../style';
import tableSchemaJson from './table.schema.json';

const isStringRecord = isStyleRecord;

export type TableSelectOption = {
  value: string;
  label: string;
};

export type TableInlineSelectSource = {
  kind: 'inline';
  options: TableSelectOption[];
};

export type TableEndpointSelectSource = {
  kind: 'endpoint';
  url: string;
  itemsPath?: string;
  valueKey?: string;
  labelKey?: string;
  headers?: Record<string, string>;
};

export type TableSelectSource = TableInlineSelectSource | TableEndpointSelectSource;

export type TableDefaultValue =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'now' }
  | { kind: 'createdAt' }
  | { kind: 'updatedAt' };

export type TableColumnBase = {
  key: string;
  label: string;
  hidden?: boolean;
  required?: boolean;
  nullable?: boolean;
  default?: TableDefaultValue;
};

export type TableStringColumn = TableColumnBase & {
  type: 'string';
  minLength?: number;
  maxLength?: number;
};

export type TableIntColumn = TableColumnBase & {
  type: 'int';
  min?: number;
  max?: number;
};

export type TableBooleanColumn = TableColumnBase & {
  type: 'boolean';
};

export type TableDateColumn = TableColumnBase & {
  type: 'date';
  dateKind?: 'date' | 'datetime';
  min?: string;
  max?: string;
};

export type TableSelectColumn = TableColumnBase & {
  type: 'select';
  source: TableSelectSource;
};

export type TableColumn =
  | TableStringColumn
  | TableIntColumn
  | TableBooleanColumn
  | TableDateColumn
  | TableSelectColumn;

export type TableSchema = {
  version: number;
  columns: TableColumn[];
};

export type TableRow = {
  id: string;
  values: Record<string, unknown>;
};

export type TableData = {
  rows: TableRow[];
};

export type TableComponent = {
  kind: 'table';
  name?: string;
  schema: TableSchema;
  data: TableData;
  padding?: Record<string, string>;
  margin?: Record<string, string>;
  sizing?: Record<string, string>;
  layout?: Record<string, string>;
  appearance?: Record<string, string>;
};

export const tableDefaults: TableComponent = {
  kind: 'table',
  name: '',
  schema: { version: 1, columns: [] },
  data: { rows: [] },
};

export const tableSchema = tableSchemaJson as SchemaField[];

export const isTableSelectOption = (value: unknown): value is TableSelectOption => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return typeof c.value === 'string' && typeof c.label === 'string';
};

export const isTableSelectSource = (value: unknown): value is TableSelectSource => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.kind === 'inline') {
    return Array.isArray(c.options) && c.options.every(isTableSelectOption);
  }
  if (c.kind === 'endpoint') {
    return (
      typeof c.url === 'string' &&
      (c.itemsPath === undefined || typeof c.itemsPath === 'string') &&
      (c.valueKey === undefined || typeof c.valueKey === 'string') &&
      (c.labelKey === undefined || typeof c.labelKey === 'string') &&
      (c.headers === undefined || isStringRecord(c.headers))
    );
  }
  return false;
};

export const isTableDefaultValue = (value: unknown): value is TableDefaultValue => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.kind === 'literal') {
    return (
      c.value === null ||
      typeof c.value === 'string' ||
      typeof c.value === 'number' ||
      typeof c.value === 'boolean'
    );
  }
  return c.kind === 'now' || c.kind === 'createdAt' || c.kind === 'updatedAt';
};

export const isTableColumn = (value: unknown): value is TableColumn => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.key !== 'string' || typeof c.label !== 'string') return false;
  if (c.hidden !== undefined && typeof c.hidden !== 'boolean') return false;
  if (c.required !== undefined && typeof c.required !== 'boolean') return false;
  if (c.nullable !== undefined && typeof c.nullable !== 'boolean') return false;
  if (c.default !== undefined && !isTableDefaultValue(c.default)) return false;

  switch (c.type) {
    case 'string':
      return (
        (c.minLength === undefined || (typeof c.minLength === 'number' && Number.isInteger(c.minLength))) &&
        (c.maxLength === undefined || (typeof c.maxLength === 'number' && Number.isInteger(c.maxLength)))
      );
    case 'int':
      return (
        (c.min === undefined || typeof c.min === 'number') &&
        (c.max === undefined || typeof c.max === 'number')
      );
    case 'boolean':
      return true;
    case 'date':
      return (
        (c.dateKind === undefined || c.dateKind === 'date' || c.dateKind === 'datetime') &&
        (c.min === undefined || typeof c.min === 'string') &&
        (c.max === undefined || typeof c.max === 'string')
      );
    case 'select':
      return isTableSelectSource(c.source);
    default:
      return false;
  }
};

export const isTableSchema = (value: unknown): value is TableSchema => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.version === 'number' &&
    Number.isInteger(c.version) &&
    c.version > 0 &&
    Array.isArray(c.columns) &&
    c.columns.every(isTableColumn)
  );
};

export const isTableRow = (value: unknown): value is TableRow => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.values === 'object' &&
    c.values !== null &&
    !Array.isArray(c.values)
  );
};

export const isTableData = (value: unknown): value is TableData => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return Array.isArray(c.rows) && c.rows.every(isTableRow);
};

export const isTableComponent = (value: unknown): value is TableComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'table' &&
    (c.name === undefined || typeof c.name === 'string') &&
    isTableSchema(c.schema) &&
    isTableData(c.data) &&
    STYLE_SPEC_KEYS.every((k) => c[k] === undefined || isStyleRecord(c[k]))
  );
};
