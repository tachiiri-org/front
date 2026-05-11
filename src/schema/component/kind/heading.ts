import type { SchemaField } from './form/field';
import { CSS_PROP_KEYS, type CssStyleProps } from '../style';
import headingSchemaJson from './heading.schema.json';

export type HeadingComponent = {
  kind: 'heading';
  name?: string;
  level?: number;
  text?: string;
} & CssStyleProps;

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
    CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string')
  );
};
