import type { StyleEntrySpec, StyleValueTarget } from './types';

export const readStyleValue = (
  map: Record<string, string>,
  target: StyleValueTarget,
): string => {
  if (Array.isArray(target)) {
    const values = target.map((key) => map[key] ?? '');
    if (values.length === 0) return '';
    const first = values[0] ?? '';
    return values.every((value) => value === first) ? first : '';
  }
  return map[target] ?? '';
};

export const writeStyleValue = (
  map: Record<string, string>,
  target: StyleValueTarget,
  value: string,
): void => {
  if (Array.isArray(target)) {
    for (const key of target) map[key] = value;
    return;
  }
  map[target] = value;
};

export const deleteStyleValue = (
  map: Record<string, string>,
  target: StyleValueTarget,
): void => {
  if (Array.isArray(target)) {
    for (const key of target) delete map[key];
    return;
  }
  delete map[target];
};

export const makeStyleEntry = (
  key: string,
  target: StyleValueTarget,
  label?: string,
  placeholder?: string,
): StyleEntrySpec => ({
  key,
  target,
  ...(label ? { label } : {}),
  ...(placeholder ? { placeholder } : {}),
});
