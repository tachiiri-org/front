import { isStyle } from '../validator';

export type ElementComponent = {
  kind: 'element';
  tag: string;
  style: Record<string, string>;
  text?: string;
  padding?: string;
};

export const elementDefaults: ElementComponent = { kind: 'element', tag: 'div', style: {} };

export const isElementComponent = (value: unknown): value is ElementComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'element' &&
    typeof c.tag === 'string' &&
    isStyle(c.style) &&
    (c.text === undefined || typeof c.text === 'string') &&
    (c.padding === undefined || typeof c.padding === 'string')
  );
};
