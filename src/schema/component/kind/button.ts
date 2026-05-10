import type { SchemaField } from './form/field';
import { STYLE_SPEC_KEYS, isStyleRecord } from '../style';
import buttonSchemaJson from './button.schema.json';

export type ButtonComponent = {
  kind: 'button';
  name?: string;
  text?: string;
  padding?: Record<string, string>;
  margin?: Record<string, string>;
  sizing?: Record<string, string>;
  layout?: Record<string, string>;
  appearance?: Record<string, string>;
};

export const buttonDefaults: ButtonComponent = {
  kind: 'button',
  name: '',
  text: '',
};

export const buttonSchema = buttonSchemaJson as SchemaField[];

export const isButtonComponent = (value: unknown): value is ButtonComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'button' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.text === undefined || typeof c.text === 'string') &&
    STYLE_SPEC_KEYS.every((k) => c[k] === undefined || isStyleRecord(c[k]))
  );
};
