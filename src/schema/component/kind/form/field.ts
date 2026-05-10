import { type TextFieldComponent, isTextFieldComponent } from './field/text';
import { type NumberFieldComponent, isNumberFieldComponent } from './field/number';
import { type TextareaFieldComponent, isTextareaFieldComponent } from './field/textarea';
import { type BooleanFieldComponent, isBooleanFieldComponent } from './field/boolean';

export type { TextFieldComponent } from './field/text';
export type { NumberFieldComponent } from './field/number';
export type { TextareaFieldComponent } from './field/textarea';
export type { BooleanFieldComponent } from './field/boolean';

export type FormFieldKind =
  | 'text'
  | 'number'
  | 'textarea'
  | 'boolean'
  | 'select'
  | 'style'
  | 'object-list'
  | 'group';

const FORM_FIELD_KIND_ALIASES: Record<string, FormFieldKind> = {
  text: 'text',
  'text-field': 'text',
  number: 'number',
  'number-field': 'number',
  textarea: 'textarea',
  'textarea-field': 'textarea',
  boolean: 'boolean',
  'boolean-field': 'boolean',
  select: 'select',
  'select-field': 'select',
  style: 'style',
  'style-field': 'style',
  'object-list': 'object-list',
  'object-list-field': 'object-list',
  group: 'group',
  'field-group': 'group',
};

export const normalizeFormFieldKind = (kind: string): string => FORM_FIELD_KIND_ALIASES[kind] ?? kind;

export type SelectFieldComponent = {
  kind: 'select';
  key: string;
  label?: string;
  options: Array<{ value: string; label: string }>;
};

export type StyleFieldComponent = {
  kind: 'style';
  key: string;
  label?: string;
  keys?: string[];
};

export type StyleMapFieldComponent = StyleFieldComponent;

export type ObjectListFieldComponent = {
  kind: 'object-list';
  key: string;
  label?: string;
  fields: FormField[];
};

export type FieldGroupComponent = {
  kind: 'group';
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
  | StyleFieldComponent
  | ObjectListFieldComponent
  | FieldGroupComponent;

export const isStyleMapFieldComponent = (v: unknown): v is StyleFieldComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    normalizeFormFieldKind(String(c.kind)) === 'style' &&
    typeof c.key === 'string' &&
    (c.label === undefined || typeof c.label === 'string') &&
    (c.keys === undefined ||
      (Array.isArray(c.keys) && c.keys.every((key) => typeof key === 'string')))
  );
};

export const isObjectListFieldComponent = (v: unknown): v is ObjectListFieldComponent => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    normalizeFormFieldKind(String(c.kind)) === 'object-list' &&
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
    normalizeFormFieldKind(String(c.kind)) === 'group' &&
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
    normalizeFormFieldKind(String(c.kind)) === 'select' &&
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
