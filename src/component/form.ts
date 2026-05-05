export type FormComponent = {
  kind: 'form';
  title?: string;
  sourceComponentId?: string;
  excludeKeys?: string[];
  padding?: string;
};

export const formDefaults: FormComponent = { kind: 'form', title: '' };

export const isFormComponent = (value: unknown): value is FormComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'form' &&
    (c.title === undefined || typeof c.title === 'string') &&
    (c.sourceComponentId === undefined || typeof c.sourceComponentId === 'string') &&
    (c.excludeKeys === undefined ||
      (Array.isArray(c.excludeKeys) && c.excludeKeys.every((e) => typeof e === 'string'))) &&
    (c.padding === undefined || typeof c.padding === 'string')
  );
};
