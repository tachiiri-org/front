import type { SchemaField } from './form/field';
import { CSS_PROP_KEYS, type CssStyleProps } from '../style';
import buttonSchemaJson from './button.schema.json';

export type ButtonComponent = {
  kind: 'button';
  name?: string;
  text?: string;
} & CssStyleProps;

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
    CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string')
  );
};
