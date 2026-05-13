import {
  componentSchemas,
  isSchemaField,
  normalizeFormFieldKind,
  type SchemaField,
} from '../../../schema/component';

const isSchemaFieldArray = (value: unknown): value is SchemaField[] =>
  Array.isArray(value) && value.every(isSchemaField);

const pickEditableData = (
  data: Record<string, unknown>,
  fields: SchemaField[],
): Record<string, unknown> => {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (typeof field.key !== 'string' || !field.key) continue;
    const value = data[field.key];
    const nestedFields = isSchemaFieldArray((field as Record<string, unknown>).fields)
      ? ((field as Record<string, unknown>).fields as SchemaField[])
      : null;
    const kind = normalizeFormFieldKind(String(field.kind));
    if (kind === 'group' || nestedFields) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        picked[field.key] = pickEditableData(value as Record<string, unknown>, nestedFields ?? []);
      } else {
        picked[field.key] = pickEditableData({}, nestedFields ?? []);
      }
      continue;
    }
    if (kind === 'object-list') {
      picked[field.key] = Array.isArray(value)
        ? value.map((item) =>
          typeof item === 'object' && item !== null && !Array.isArray(item)
            ? pickEditableData(item as Record<string, unknown>, nestedFields ?? [])
            : pickEditableData({}, nestedFields ?? []))
        : [];
      continue;
    }
    if (value !== undefined) picked[field.key] = value;
  }
  return picked;
};

const loadSchemaDefinition = async (kind: string): Promise<SchemaField[] | null> => {
  const response = await fetch(`/api/component-schemas/${encodeURIComponent(kind)}/definition`);
  if (!response.ok) return null;
  const payload = (await response.json()) as unknown;
  if (!isSchemaFieldArray(payload)) return null;
  return payload;
};

export const loadComponentPropertySchema = async (
  componentKind: string | null,
): Promise<SchemaField[] | null> => {
  if (!componentKind) return null;
  return loadSchemaDefinition(componentKind);
};

export const pickEditableComponentData = (
  data: Record<string, unknown>,
  componentKind: string | null,
  schema: SchemaField[] | null = null,
): Record<string, unknown> => {
  const fields = schema ?? (componentKind ? componentSchemas[componentKind] ?? null : null);
  if (!fields) return {};
  return pickEditableData(data, fields);
};
