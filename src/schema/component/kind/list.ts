import type { SchemaField } from './form/field';
import { STYLE_SPEC_KEYS, isStyleRecord } from '../style';
import listSchemaJson from './list.schema.json';

export const LIST_RESOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'layouts', label: 'layouts' },
];

export type ListComponent = {
  kind: 'list';
  name?: string;
  resource?: string;
  targetComponentId?: string;
  padding?: Record<string, string>;
  margin?: Record<string, string>;
  sizing?: Record<string, string>;
  layout?: Record<string, string>;
  appearance?: Record<string, string>;
  itemStyle?: Record<string, string>;
};

export const listDefaults: ListComponent = {
  kind: 'list',
  name: '',
  resource: 'layouts',
  targetComponentId: '',
};

export const listSchema = listSchemaJson as SchemaField[];

export const isListComponent = (value: unknown): value is ListComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'list' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.resource === undefined || typeof c.resource === 'string') &&
    (c.targetComponentId === undefined || typeof c.targetComponentId === 'string') &&
    (c.itemStyle === undefined || isStyleRecord(c.itemStyle)) &&
    STYLE_SPEC_KEYS.every((k) => c[k] === undefined || isStyleRecord(c[k]))
  );
};
