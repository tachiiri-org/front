import type { SchemaField } from './form/field';
import { ALL_CSS_PROP_KEYS, type CssStyleProps } from '../style';
import elementSchemaJson from './element.schema.json';

export type ElementEndpointSource = {
  kind: 'endpoint';
  url: string;
  valuePath?: string;
  fallback?: string;
};

export type ElementComponent = {
  kind: 'element';
  name?: string;
  tag?: string;
  text?: string;
  href?: string;
  src?: string;
  alt?: string;
  placeholder?: string;
  type?: string;
  target?: string;
  value?: string;
  children?: ElementComponent[];
  source?: ElementEndpointSource;
} & CssStyleProps;

export const elementDefaults: ElementComponent = { kind: 'element', name: '', tag: 'div', text: '' };

export const elementSchema = elementSchemaJson as SchemaField[];

const isElementEndpointSource = (v: unknown): v is ElementEndpointSource => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  return (
    s.kind === 'endpoint' &&
    typeof s.url === 'string' &&
    (s.valuePath === undefined || typeof s.valuePath === 'string') &&
    (s.fallback === undefined || typeof s.fallback === 'string')
  );
};

export const isElementComponent = (value: unknown): value is ElementComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'element' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.tag === undefined || typeof c.tag === 'string') &&
    (c.text === undefined || typeof c.text === 'string') &&
    (c.href === undefined || typeof c.href === 'string') &&
    (c.source === undefined || isElementEndpointSource(c.source)) &&
    (c.src === undefined || typeof c.src === 'string') &&
    (c.alt === undefined || typeof c.alt === 'string') &&
    (c.placeholder === undefined || typeof c.placeholder === 'string') &&
    (c.type === undefined || typeof c.type === 'string') &&
    (c.target === undefined || typeof c.target === 'string') &&
    (c.value === undefined || typeof c.value === 'string') &&
    (c.children === undefined || (Array.isArray(c.children) && c.children.every(isElementComponent))) &&
    ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string')
  );
};
