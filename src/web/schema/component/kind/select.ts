import type { SchemaField } from './form/field';
import { ALL_CSS_PROP_KEYS, isStyleRecord, type CssStyleProps } from '../style';
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

export type SelectInlineSource = {
  kind: 'inline';
  options: SelectOption[];
};

export type SelectSource = SelectEndpointSource | SelectInlineSource;

export type SelectComponent = {
  kind: 'select';
  name?: string;
  source: SelectSource;
  targetComponentId?: string;
} & CssStyleProps;

export const isSelectOption = (value: unknown): value is SelectOption => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Partial<SelectOption>;
  return typeof c.value === 'string' && typeof c.label === 'string';
};

const isSelectEndpointSource = (value: unknown): value is SelectEndpointSource => {
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

const isSelectInlineSource = (value: unknown): value is SelectInlineSource => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return c.kind === 'inline' && Array.isArray(c.options) && (c.options as unknown[]).every(isSelectOption);
};

export const isSelectSource = (value: unknown): value is SelectSource =>
  isSelectEndpointSource(value) || isSelectInlineSource(value);

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
    ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string')
  );
};
