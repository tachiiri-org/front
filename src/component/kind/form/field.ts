import { type TextFieldComponent, isTextFieldComponent } from './field/text';
import { type NumberFieldComponent, isNumberFieldComponent } from './field/number';
import { type TextareaFieldComponent, isTextareaFieldComponent } from './field/textarea';
import { type BooleanFieldComponent, isBooleanFieldComponent } from './field/boolean';

export type { TextFieldComponent } from './field/text';
export type { NumberFieldComponent } from './field/number';
export type { TextareaFieldComponent } from './field/textarea';
export type { BooleanFieldComponent } from './field/boolean';

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

export type FormField =
  | TextFieldComponent
  | NumberFieldComponent
  | TextareaFieldComponent
  | BooleanFieldComponent
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

export const isFormField = (v: unknown): v is FormField =>
  isTextFieldComponent(v) ||
  isNumberFieldComponent(v) ||
  isTextareaFieldComponent(v) ||
  isBooleanFieldComponent(v) ||
  isStyleMapFieldComponent(v) ||
  isObjectListFieldComponent(v) ||
  isFieldGroupComponent(v);

