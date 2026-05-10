import type { FormField } from './form/field';
import type { SchemaField } from './form/field';
import buttonSchemaJson from './button.schema.json';

export type ButtonComponent = {
  kind: 'button';
  name?: string;
  text?: string;
  padding?: string;
};

export const buttonDefaults: ButtonComponent = { kind: 'button', name: '', text: '', padding: '' };

export const buttonSchema = buttonSchemaJson as SchemaField[];

export const isButtonComponent = (value: unknown): value is ButtonComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'button' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.text === undefined || typeof c.text === 'string') &&
    (c.padding === undefined || typeof c.padding === 'string')
  );
};
