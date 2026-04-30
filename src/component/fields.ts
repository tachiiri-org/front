import { isStyle } from './validator';

export type TextFieldComponent = {
  kind: 'text-field';
  key: string;
  label?: string;
  style?: Record<string, string>;
};

export type NumberFieldComponent = {
  kind: 'number-field';
  key: string;
  label?: string;
  style?: Record<string, string>;
};

export type TextareaComponent = {
  kind: 'textarea';
  key: string;
  label?: string;
  style?: Record<string, string>;
};

export type StyleMapFieldComponent = {
  kind: 'style-map-field';
  key: string;
  label?: string;
};

export type ObjectListFieldComponent = {
  kind: 'object-list-field';
  key: string;
  label?: string;
  fields: FieldComponent[];
};

export type FieldGroupComponent = {
  kind: 'field-group';
  key?: string;
  label?: string;
  fields: FieldComponent[];
};

export type FieldComponent =
  | TextFieldComponent
  | NumberFieldComponent
  | TextareaComponent
  | StyleMapFieldComponent
  | ObjectListFieldComponent
  | FieldGroupComponent;

const hasOptionalLabel = (c: Record<string, unknown>): boolean =>
  c.label === undefined || typeof c.label === 'string';

const hasOptionalStyle = (c: Record<string, unknown>): boolean =>
  c.style === undefined || isStyle(c.style);

const hasStringKey = (c: Record<string, unknown>): boolean =>
  typeof c.key === 'string';

export const isTextFieldComponent = (v: unknown): v is TextFieldComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return c.kind === 'text-field' && hasStringKey(c) && hasOptionalLabel(c) && hasOptionalStyle(c);
};

export const isNumberFieldComponent = (v: unknown): v is NumberFieldComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return c.kind === 'number-field' && hasStringKey(c) && hasOptionalLabel(c) && hasOptionalStyle(c);
};

export const isTextareaComponent = (v: unknown): v is TextareaComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return c.kind === 'textarea' && hasStringKey(c) && hasOptionalLabel(c) && hasOptionalStyle(c);
};

export const isStyleMapFieldComponent = (v: unknown): v is StyleMapFieldComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return c.kind === 'style-map-field' && hasStringKey(c) && hasOptionalLabel(c);
};

export const isObjectListFieldComponent = (v: unknown): v is ObjectListFieldComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    c.kind === 'object-list-field' &&
    hasStringKey(c) &&
    hasOptionalLabel(c) &&
    Array.isArray(c.fields) &&
    (c.fields as unknown[]).every((f) => isFieldComponent(f))
  );
};

export const isFieldGroupComponent = (v: unknown): v is FieldGroupComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    c.kind === 'field-group' &&
    (c.key === undefined || typeof c.key === 'string') &&
    hasOptionalLabel(c) &&
    Array.isArray(c.fields) &&
    (c.fields as unknown[]).every((f) => isFieldComponent(f))
  );
};

export const isFieldComponent = (v: unknown): v is FieldComponent =>
  isTextFieldComponent(v) ||
  isNumberFieldComponent(v) ||
  isTextareaComponent(v) ||
  isStyleMapFieldComponent(v) ||
  isObjectListFieldComponent(v) ||
  isFieldGroupComponent(v);
