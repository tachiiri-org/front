import { type TextFieldComponent, isTextFieldComponent } from './field/text';
import { type NumberFieldComponent, isNumberFieldComponent } from './field/number';
import { type TextareaFieldComponent, isTextareaFieldComponent } from './field/textarea';
import { type BooleanFieldComponent, isBooleanFieldComponent } from './field/boolean';

export type { TextFieldComponent } from './field/text';
export type { NumberFieldComponent } from './field/number';
export type { TextareaFieldComponent } from './field/textarea';
export type { BooleanFieldComponent } from './field/boolean';

export type SelectFieldComponent = {
  kind: 'select-field';
  key: string;
  label?: string;
  options: Array<{ value: string; label: string }>;
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
  fields: FormField[];
};

export type FieldGroupComponent = {
  kind: 'field-group';
  key?: string;
  label?: string;
  fields: FormField[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
};

export type SchemaField = {
  kind: string;
  key?: string;
  label?: string;
  fields?: SchemaField[];
  options?: Array<{ value: string; label: string }>;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  [key: string]: unknown;
};

export type FormField =
  | TextFieldComponent
  | NumberFieldComponent
  | TextareaFieldComponent
  | BooleanFieldComponent
  | SelectFieldComponent
  | StyleMapFieldComponent
  | ObjectListFieldComponent
  | FieldGroupComponent;

export const isStyleMapFieldComponent = (v: unknown): v is StyleMapFieldComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    c.kind === 'style-map-field' &&
    typeof c.key === 'string' &&
    (c.label === undefined || typeof c.label === 'string')
  );
};

export const isObjectListFieldComponent = (v: unknown): v is ObjectListFieldComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    c.kind === 'object-list-field' &&
    typeof c.key === 'string' &&
    (c.label === undefined || typeof c.label === 'string') &&
    Array.isArray(c.fields) &&
    (c.fields as unknown[]).every((f) => isFormField(f))
  );
};

export const isFieldGroupComponent = (v: unknown): v is FieldGroupComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    c.kind === 'field-group' &&
    (c.key === undefined || typeof c.key === 'string') &&
    (c.label === undefined || typeof c.label === 'string') &&
    Array.isArray(c.fields) &&
    (c.fields as unknown[]).every((f) => isFormField(f)) &&
    (c.collapsible === undefined || typeof c.collapsible === 'boolean') &&
    (c.defaultCollapsed === undefined || typeof c.defaultCollapsed === 'boolean')
  );
};

const isSchemaFieldOption = (value: unknown): value is { value: string; label: string } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return typeof c.value === 'string' && typeof c.label === 'string';
};

export const isSchemaField = (value: unknown): value is SchemaField => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.kind === 'string' &&
    (c.key === undefined || typeof c.key === 'string') &&
    (c.label === undefined || typeof c.label === 'string') &&
    (c.fields === undefined ||
      (Array.isArray(c.fields) && c.fields.every((field) => isSchemaField(field)))) &&
    (c.options === undefined ||
      (Array.isArray(c.options) && c.options.every(isSchemaFieldOption))) &&
    (c.collapsible === undefined || typeof c.collapsible === 'boolean') &&
    (c.defaultCollapsed === undefined || typeof c.defaultCollapsed === 'boolean')
  );
};

export const isSelectFieldComponent = (v: unknown): v is SelectFieldComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    c.kind === 'select-field' &&
    typeof c.key === 'string' &&
    (c.label === undefined || typeof c.label === 'string') &&
    Array.isArray(c.options) &&
    (c.options as unknown[]).every(
      (o) => typeof o === 'object' && o !== null && typeof (o as Record<string, unknown>).value === 'string' && typeof (o as Record<string, unknown>).label === 'string',
    )
  );
};

export const isFormField = (v: unknown): v is FormField =>
  isTextFieldComponent(v) ||
  isNumberFieldComponent(v) ||
  isTextareaFieldComponent(v) ||
  isBooleanFieldComponent(v) ||
  isSelectFieldComponent(v) ||
  isStyleMapFieldComponent(v) ||
  isObjectListFieldComponent(v) ||
  isFieldGroupComponent(v);
