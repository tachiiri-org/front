import { ALL_CSS_PROP_KEYS } from '../style';
import type { CssStyleProps } from '../style';
import type { SchemaField } from './form/field';

export type DbApplyComponent = {
  kind: 'db-apply';
  name?: string;
} & CssStyleProps;

export const dbApplyDefaults: DbApplyComponent = {
  kind: 'db-apply',
  name: '',
};

export const dbApplySchema: SchemaField[] = [
  { kind: 'text-field', key: 'name', label: 'name' },
];

export const isDbApplyComponent = (value: unknown): value is DbApplyComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.kind !== 'db-apply') return false;
  if (c.name !== undefined && typeof c.name !== 'string') return false;
  return ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string');
};
