import type { FormField } from '../../../schema/component';

function inferField(key: string, value: unknown): FormField {
  if (typeof value === 'boolean') return { kind: 'boolean', key };
  if (typeof value === 'number') return { kind: 'number', key };
  if (typeof value === 'string') {
    return value.includes('\n') || value.length >= 100
      ? { kind: 'textarea', key }
      : { kind: 'text', key };
  }
  if (Array.isArray(value)) {
    const allObjects = value.length > 0 && value.every(
      (item) => typeof item === 'object' && item !== null && !Array.isArray(item),
    );
    if (allObjects) {
      return {
        kind: 'object-list',
        key,
        fields: inferFieldsFromData(value[0] as Record<string, unknown>),
      };
    }
    return { kind: 'textarea', key };
  }
  if (typeof value === 'object' && value !== null) {
    return { kind: 'group', key, fields: inferFieldsFromData(value as Record<string, unknown>) };
  }
  return { kind: 'textarea', key };
}

export function inferFieldsFromData(data: Record<string, unknown>): FormField[] {
  return Object.entries(data).map(([key, value]) => inferField(key, value));
}
