export type ButtonComponent = {
  kind: 'button';
  text?: string;
  padding?: string;
};

export const buttonDefaults: ButtonComponent = { kind: 'button', text: '' };

export const isButtonComponent = (value: unknown): value is ButtonComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'button' &&
    (c.text === undefined || typeof c.text === 'string') &&
    (c.padding === undefined || typeof c.padding === 'string')
  );
};
