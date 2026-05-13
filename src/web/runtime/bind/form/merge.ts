import type { SchemaField } from '../../../schema/component';

export function mergeWithSchema(
  inferred: SchemaField[],
  schema: SchemaField[],
): SchemaField[] {
  const schemaByKey = new Map<string, SchemaField>();
  for (const f of schema) {
    const key = 'key' in f && f.key ? f.key : undefined;
    if (key) schemaByKey.set(key, f);
  }

  const usedKeys = new Set<string>();
  const result: SchemaField[] = [];

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
