import type { SchemaField } from './form/field';
import { ALL_CSS_PROP_KEYS, type CssStyleProps } from '../style';
import formSchemaJson from './form.schema.json';

export type FormComponent = {
  kind: 'form';
  name?: string;
  title?: string;
  sourceComponentId?: string;
  excludeKeys?: string[];
} & CssStyleProps;

export const formDefaults: FormComponent = {
  kind: 'form',
  name: '',
  title: '',
  sourceComponentId: '',
  excludeKeys: [],
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
    ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string')
  );
};
