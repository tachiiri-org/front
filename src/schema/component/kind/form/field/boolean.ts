export type BooleanFieldComponent = {
  kind: 'boolean';
  key: string;
  label?: string;
};

export const isBooleanFieldComponent = (v: unknown): v is BooleanFieldComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    (c.kind === 'boolean' || c.kind === 'boolean-field') &&
    typeof c.key === 'string' &&
    (c.label === undefined || typeof c.label === 'string')
  );
};
