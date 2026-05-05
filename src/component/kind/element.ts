const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

export type ElementComponent = {
  kind: 'element';
  tag: string;
  style: Record<string, string>;
  text?: string;
  padding?: string;
};

export const elementDefaults: ElementComponent = { kind: 'element', tag: 'div', style: {}, text: '', padding: '' };

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
