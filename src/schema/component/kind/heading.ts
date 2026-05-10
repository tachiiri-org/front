import type { SchemaField } from './form/field';
import { STYLE_SPEC_KEYS, isStyleRecord } from '../style';
import headingSchemaJson from './heading.schema.json';

export type HeadingComponent = {
  kind: 'heading';
  name?: string;
  level?: number;
  text?: string;
  padding?: Record<string, string>;
  margin?: Record<string, string>;
  sizing?: Record<string, string>;
  layout?: Record<string, string>;
  appearance?: Record<string, string>;
};

export const headingDefaults: HeadingComponent = {
  kind: 'heading',
  name: '',
  level: 1,
  text: '',
};

export const headingSchema = headingSchemaJson as SchemaField[];

export const isHeadingComponent = (value: unknown): value is HeadingComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'heading' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.level === undefined || (typeof c.level === 'number' && Number.isInteger(c.level))) &&
    (c.text === undefined || typeof c.text === 'string') &&
    STYLE_SPEC_KEYS.every((k) => c[k] === undefined || isStyleRecord(c[k]))
  );
};
