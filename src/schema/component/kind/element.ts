import type { FormField } from './form/field';
import type { SchemaField } from './form/field';
import elementSchemaJson from './element.schema.json';

const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

export type ElementComponent = {
  kind: 'element';
  name?: string;
  tag?: string;
  style?: Record<string, string>;
  text?: string;
  padding?: string;
};

export const elementDefaults: ElementComponent = { kind: 'element', name: '', tag: 'div', style: {}, text: '', padding: '' };

export const elementSchema = elementSchemaJson as SchemaField[];

export const isElementComponent = (value: unknown): value is ElementComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'element' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.tag === undefined || typeof c.tag === 'string') &&
    (c.style === undefined || isStyle(c.style)) &&
    (c.text === undefined || typeof c.text === 'string') &&
    (c.padding === undefined || typeof c.padding === 'string')
  );
};
