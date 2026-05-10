import type { FormField } from './form/field';
import type { SchemaField } from './form/field';
import formSchemaJson from './form.schema.json';

const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

export type FormComponent = {
  kind: 'form';
  name?: string;
  title?: string;
  sourceComponentId?: string;
  excludeKeys?: string[];
  padding?: string;
  style?: Record<string, string>;
};

export const formDefaults: FormComponent = {
  kind: 'form',
  name: '',
  title: '',
  sourceComponentId: '',
  excludeKeys: [],
  padding: '',
  style: {},
};

export const formSchema = formSchemaJson as SchemaField[];

export const isFormComponent = (value: unknown): value is FormComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'form' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.title === undefined || typeof c.title === 'string') &&
    (c.sourceComponentId === undefined || typeof c.sourceComponentId === 'string') &&
    (c.excludeKeys === undefined ||
      (Array.isArray(c.excludeKeys) && c.excludeKeys.every((e) => typeof e === 'string'))) &&
    (c.padding === undefined || typeof c.padding === 'string') &&
    (c.style === undefined || isStyle(c.style))
  );
};
