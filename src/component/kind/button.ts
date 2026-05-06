import type { FormField } from './form/field';

export type ButtonComponent = {
  kind: 'button';
  text?: string;
  padding?: string;
};

export const buttonDefaults: ButtonComponent = { kind: 'button', text: '', padding: '' };

export const buttonSchema: FormField[] = [
  { kind: 'text-field', key: 'text', label: 'text' },
  { kind: 'text-field', key: 'padding', label: 'padding' },
];

export const isButtonComponent = (value: unknown): value is ButtonComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'button' &&
    (c.text === undefined || typeof c.text === 'string') &&
    (c.padding === undefined || typeof c.padding === 'string')
  );
};
