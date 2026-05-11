import type { SchemaField } from './form/field';
import { ALL_CSS_PROP_KEYS, type CssStyleProps } from '../style';
import elementSchemaJson from './element.schema.json';

export type ElementComponent = {
  kind: 'element';
  name?: string;
  tag?: string;
  text?: string;
} & CssStyleProps;

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
    ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string')
  );
};
