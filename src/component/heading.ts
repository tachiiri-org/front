export type HeadingComponent = {
  kind: 'heading';
  level?: number;
  text?: string;
  padding?: string;
};

export const headingDefaults: HeadingComponent = { kind: 'heading', level: 1, text: '' };

export const isHeadingComponent = (value: unknown): value is HeadingComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'heading' &&
    (c.level === undefined || (typeof c.level === 'number' && Number.isInteger(c.level))) &&
    (c.text === undefined || typeof c.text === 'string') &&
    (c.padding === undefined || typeof c.padding === 'string')
  );
};
