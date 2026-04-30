import { isStyle } from './validator';

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

export const isSelectComponent = (value: unknown): value is SelectComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'select' &&
    isSelectSource(c.source) &&
    (c.targetComponentId === undefined || typeof c.targetComponentId === 'string') &&
    (c.padding === undefined || typeof c.padding === 'string')
  );
};
