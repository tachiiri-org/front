import type { FormField } from '../../component/kind/form/field';

function inferField(key: string, value: unknown): FormField {
  if (typeof value === 'boolean') return { kind: 'boolean-field', key };
  if (typeof value === 'number') return { kind: 'number-field', key };
  if (typeof value === 'string') {
    return value.includes('\n') || value.length >= 100
      ? { kind: 'textarea-field', key }
      : { kind: 'text-field', key };
  }
  if (Array.isArray(value)) {
    const allObjects = value.length > 0 && value.every(
      (item) => typeof item === 'object' && item !== null && !Array.isArray(item),
    );
    if (allObjects) {
      return {
        kind: 'object-list-field',
        key,
        fields: inferFieldsFromData(value[0] as Record<string, unknown>),
      };
    }
    return { kind: 'textarea-field', key };
  }
  if (typeof value === 'object' && value !== null) {
    return { kind: 'field-group', key, fields: inferFieldsFromData(value as Record<string, unknown>) };
  }
  return { kind: 'textarea-field', key };
}

export function inferFieldsFromData(data: Record<string, unknown>): FormField[] {
  return Object.entries(data).map(([key, value]) => inferField(key, value));
}
