import type { SchemaField } from './form/field';
import { STYLE_SPEC_KEYS, isStyleRecord } from '../style';
import selectSchemaJson from './select.schema.json';

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
  padding?: Record<string, string>;
  margin?: Record<string, string>;
  sizing?: Record<string, string>;
  layout?: Record<string, string>;
  appearance?: Record<string, string>;
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
    (c.headers === undefined || isStyleRecord(c.headers))
  );
};

export const selectDefaults: SelectComponent = {
  kind: 'select',
  name: '',
  source: { kind: 'endpoint', url: '', itemsPath: '', valueKey: '', labelKey: '', headers: {} },
  targetComponentId: '',
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
    STYLE_SPEC_KEYS.every((k) => c[k] === undefined || isStyleRecord(c[k]))
  );
};
