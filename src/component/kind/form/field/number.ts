const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

export type NumberFieldComponent = {
  kind: 'number-field';
  key: string;
  label?: string;
  style?: Record<string, string>;
};

export const isNumberFieldComponent = (v: unknown): v is NumberFieldComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    c.kind === 'number-field' &&
    typeof c.key === 'string' &&
    (c.label === undefined || typeof c.label === 'string') &&
    (c.style === undefined || isStyle(c.style))
  );
};
