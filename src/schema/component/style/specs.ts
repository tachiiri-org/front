import type { StyleEntrySpec } from './types';

export const STYLE_FIELD_SPECS = {
  padding: [
    { key: 't', label: 't', target: 'paddingTop' },
    { key: 'r', label: 'r', target: 'paddingRight' },
    { key: 'b', label: 'b', target: 'paddingBottom' },
    { key: 'l', label: 'l', target: 'paddingLeft' },
  ],
  margin: [
    { key: 't', label: 't', target: 'marginTop' },
    { key: 'r', label: 'r', target: 'marginRight' },
    { key: 'b', label: 'b', target: 'marginBottom' },
    { key: 'l', label: 'l', target: 'marginLeft' },
  ],
} as const satisfies Record<string, readonly StyleEntrySpec[]>;

export type StyleSpecKey = keyof typeof STYLE_FIELD_SPECS;

export const resolveStyleFieldEntries = (styleSpecKey: string): StyleEntrySpec[] | null => {
  const entries = STYLE_FIELD_SPECS[styleSpecKey as StyleSpecKey];
  return entries ? entries.map((entry) => ({ ...entry })) : null;
};
