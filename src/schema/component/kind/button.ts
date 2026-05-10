import type { FormField } from './form/field';
import type { SchemaField } from './form/field';
import buttonSchemaJson from './button.schema.json';

const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

export type ButtonComponent = {
  kind: 'button';
  name?: string;
  text?: string;
  padding?: string;
  style?: Record<string, string>;
};

export const buttonDefaults: ButtonComponent = {
  kind: 'button',
  name: '',
  text: '',
  padding: '',
  style: {},
};

export const buttonSchema = buttonSchemaJson as SchemaField[];

export const isButtonComponent = (value: unknown): value is ButtonComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'button' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.text === undefined || typeof c.text === 'string') &&
    (c.padding === undefined || typeof c.padding === 'string') &&
    (c.style === undefined || isStyle(c.style))
  );
};
