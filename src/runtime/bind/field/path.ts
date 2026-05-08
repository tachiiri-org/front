import type { FormField } from '../../../schema/component';

export const getAtPath = (obj: unknown, path: string): unknown => {
  if (!path) return obj;
  return path.split('.').reduce((acc: unknown, key: string) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    if (Array.isArray(acc)) {
      const idx = parseInt(key, 10);
      return isNaN(idx) ? undefined : (acc as unknown[])[idx];
    }
    return (acc as Record<string, unknown>)[key];
  }, obj);
};

export const setAtPath = (obj: unknown, path: string, value: unknown): void => {
  if (!path || obj === null || typeof obj !== 'object') return;
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce((acc: unknown, key: string): unknown => {
    if (acc === null || typeof acc !== 'object') return null;
    if (Array.isArray(acc)) {
      const idx = parseInt(key, 10);
      return isNaN(idx) ? null : (acc as unknown[])[idx];
    }
    return (acc as Record<string, unknown>)[key] ?? null;
  }, obj);
  if (parent === null || typeof parent !== 'object') return;
  if (Array.isArray(parent)) {
    const idx = parseInt(last, 10);
    if (!isNaN(idx)) (parent as unknown[])[idx] = value;
  } else {
    (parent as Record<string, unknown>)[last] = value;
  }
};

export const blankFromSchema = (fields: FormField[]): Record<string, unknown> => {
  const obj: Record<string, unknown> = {};
  for (const field of fields) {
    if (!('key' in field) || !field.key) continue;
    if (field.kind === 'number-field') obj[field.key] = 0;
    else if (field.kind === 'boolean-field') obj[field.key] = false;
    else if (field.kind === 'text-field' || field.kind === 'textarea-field') obj[field.key] = '';
    else if (field.kind === 'style-map-field') obj[field.key] = {};
    else if (field.kind === 'object-list-field') obj[field.key] = [];
  }
  return obj;
};
