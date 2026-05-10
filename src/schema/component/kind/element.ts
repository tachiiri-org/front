import type { SchemaField } from './form/field';
import { STYLE_SPEC_KEYS, isStyleRecord } from '../style';
import elementSchemaJson from './element.schema.json';

export type ElementComponent = {
  kind: 'element';
  name?: string;
  tag?: string;
  text?: string;
  padding?: Record<string, string>;
  margin?: Record<string, string>;
  sizing?: Record<string, string>;
  layout?: Record<string, string>;
  appearance?: Record<string, string>;
};

export const elementDefaults: ElementComponent = { kind: 'element', name: '', tag: 'div', text: '' };

export const elementSchema = elementSchemaJson as SchemaField[];

export const isElementComponent = (value: unknown): value is ElementComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'element' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.tag === undefined || typeof c.tag === 'string') &&
    (c.text === undefined || typeof c.text === 'string') &&
    STYLE_SPEC_KEYS.every((k) => c[k] === undefined || isStyleRecord(c[k]))
  );
};
