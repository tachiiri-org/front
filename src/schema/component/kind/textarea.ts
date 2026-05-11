import type { SchemaField } from './form/field';
import { ALL_CSS_PROP_KEYS, type CssStyleProps } from '../style';
import textareaSchemaJson from './textarea.schema.json';

export type TextareaComponent = {
  kind: 'textarea';
  name?: string;
  language?: 'json' | 'plain';
  value?: string;
  rows?: number;
} & CssStyleProps;

export const textareaDefaults: TextareaComponent = {
  kind: 'textarea',
  name: '',
  language: 'plain',
  value: '',
  rows: 4,
};

export const textareaSchema = textareaSchemaJson as SchemaField[];

export const isTextareaComponent = (value: unknown): value is TextareaComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'textarea' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.language === undefined || c.language === 'json' || c.language === 'plain') &&
    (c.value === undefined || typeof c.value === 'string') &&
    (c.rows === undefined || (typeof c.rows === 'number' && Number.isInteger(c.rows) && c.rows > 0)) &&
    ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string')
  );
};
