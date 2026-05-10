import { componentSchemas, type FormField } from '../../../schema/component';
import { editorSchema } from '../../../editor/component-editor';

const NAME_FIELD: FormField = { kind: 'text-field', key: 'name', label: 'name' };

const withName = (fields: FormField[] | null): FormField[] => {
  if (!fields) return [NAME_FIELD];
  return [NAME_FIELD, ...fields];
};

const COMPONENT_PROPERTY_SCHEMAS: Record<string, FormField[]> = {
  element: withName(componentSchemas.element ?? null),
  heading: withName(componentSchemas.heading ?? null),
  button: withName(componentSchemas.button ?? null),
  form: withName(componentSchemas.form ?? null),
  select: withName(componentSchemas.select ?? null),
  canvas: withName(componentSchemas.canvas ?? null),
  list: withName(componentSchemas.list ?? null),
  textarea: withName(componentSchemas.textarea ?? null),
  table: withName(componentSchemas.table ?? null),
  'component-editor': editorSchema,
};

const pickEditableData = (
  data: Record<string, unknown>,
  fields: FormField[],
): Record<string, unknown> => {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (!('key' in field) || !field.key) continue;
    const value = data[field.key];
    if (field.kind === 'field-group') {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        picked[field.key] = pickEditableData(value as Record<string, unknown>, field.fields);
      } else {
        picked[field.key] = pickEditableData({}, field.fields);
      }
      continue;
    }
    if (field.kind === 'object-list-field') {
      picked[field.key] = Array.isArray(value)
        ? value.map((item) =>
          typeof item === 'object' && item !== null && !Array.isArray(item)
            ? pickEditableData(item as Record<string, unknown>, field.fields)
            : pickEditableData({}, field.fields))
        : [];
      continue;
    }
    if (value !== undefined) picked[field.key] = value;
  }
  return picked;
};

export const getComponentPropertySchema = (componentKind: string | null): FormField[] | null => {
  if (!componentKind) return null;
  return COMPONENT_PROPERTY_SCHEMAS[componentKind] ?? [NAME_FIELD];
};

export const pickEditableComponentData = (
  data: Record<string, unknown>,
  componentKind: string | null,
): Record<string, unknown> => {
  const fields = getComponentPropertySchema(componentKind);
  if (!fields) {
    const editable: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(data, 'name')) editable.name = data.name;
    return editable;
  }
  return pickEditableData(data, fields);
};
