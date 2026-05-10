import type { FormField } from './form/field';
import type { SchemaField } from './form/field';
import textareaSchemaJson from './textarea.schema.json';

const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

export type TextareaComponent = {
  kind: 'textarea';
  name?: string;
  language?: 'json' | 'plain';
  value?: string;
  rows?: number;
  style?: Record<string, string>;
};

export const textareaDefaults: TextareaComponent = {
  kind: 'textarea',
  name: '',
  language: 'plain',
  value: '',
  rows: 4,
  style: {},
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
    (c.style === undefined || isStyle(c.style))
  );
};
