import type { FormField } from './form/field';
import type { SchemaField } from './form/field';
import selectSchemaJson from './select.schema.json';

const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectEndpointSource = {
  kind: 'endpoint';
  url: string;
  itemsPath?: string;
  valueKey?: string;
  labelKey?: string;
  headers?: Record<string, string>;
};

export type SelectSource = SelectEndpointSource;

export type SelectComponent = {
  kind: 'select';
  name?: string;
  source: SelectSource;
  targetComponentId?: string;
  padding?: string;
};

export const isSelectOption = (value: unknown): value is SelectOption => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Partial<SelectOption>;
  return typeof c.value === 'string' && typeof c.label === 'string';
};

export const isSelectSource = (value: unknown): value is SelectSource => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.kind !== 'endpoint') return false;
  return (
    typeof c.url === 'string' &&
    (c.itemsPath === undefined || typeof c.itemsPath === 'string') &&
    (c.valueKey === undefined || typeof c.valueKey === 'string') &&
    (c.labelKey === undefined || typeof c.labelKey === 'string') &&
    (c.headers === undefined || isStyle(c.headers))
  );
};

export const selectDefaults: SelectComponent = {
  kind: 'select',
  name: '',
  source: { kind: 'endpoint', url: '', itemsPath: '', valueKey: '', labelKey: '', headers: {} },
  targetComponentId: '',
  padding: '',
};

export const selectSchema = selectSchemaJson as SchemaField[];

export const isSelectComponent = (value: unknown): value is SelectComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'select' &&
    (c.name === undefined || typeof c.name === 'string') &&
    isSelectSource(c.source) &&
    (c.targetComponentId === undefined || typeof c.targetComponentId === 'string') &&
    (c.padding === undefined || typeof c.padding === 'string')
  );
};
