import type { FormField } from './form/field';
import type { SchemaField } from './form/field';
import headingSchemaJson from './heading.schema.json';

const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

export type HeadingComponent = {
  kind: 'heading';
  name?: string;
  level?: number;
  text?: string;
  padding?: string;
  style?: Record<string, string>;
};

export const headingDefaults: HeadingComponent = {
  kind: 'heading',
  name: '',
  level: 1,
  text: '',
  padding: '',
  style: {},
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
    (c.padding === undefined || typeof c.padding === 'string') &&
    (c.style === undefined || isStyle(c.style))
  );
};
