import type { FormField } from '../../component/kind/form/field';

export function mergeWithSchema(
  inferred: FormField[],
  schema: FormField[],
): FormField[] {
  const schemaByKey = new Map<string, FormField>();
  for (const f of schema) {
    const key = 'key' in f && f.key ? f.key : undefined;
    if (key) schemaByKey.set(key, f);
  }

  const usedKeys = new Set<string>();
  const result: FormField[] = [];

  for (const f of inferred) {
    const key = 'key' in f && f.key ? f.key : undefined;
    if (key && schemaByKey.has(key)) {
      result.push(schemaByKey.get(key)!);
      usedKeys.add(key);
    } else {
      result.push(f);
    }
  }

  for (const f of schema) {
    const key = 'key' in f && f.key ? f.key : undefined;
    if (!key || !usedKeys.has(key)) result.push(f);
  }

  return result;
}
