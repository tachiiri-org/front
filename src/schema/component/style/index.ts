export type { StyleEntrySpec, StyleSpec, StyleValueTarget, StyleSpecKey, StyleSpecProps } from './types';
export { readStyleValue, writeStyleValue, deleteStyleValue, makeStyleEntry } from './shared';
export { paddingStyleSpec } from './padding';
export { marginStyleSpec } from './margin';
export { layoutStyleSpec } from './layout';
export { appearanceStyleSpec } from './appearance';
export { sizingStyleSpec } from './sizing';

import { appearanceStyleSpec } from './appearance';
import { marginStyleSpec } from './margin';
import { layoutStyleSpec } from './layout';
import { paddingStyleSpec } from './padding';
import { sizingStyleSpec } from './sizing';
import type { StyleSpec } from './types';

export const STYLE_SPECS: Record<string, StyleSpec> = {
  padding: paddingStyleSpec,
  margin: marginStyleSpec,
  sizing: sizingStyleSpec,
  layout: layoutStyleSpec,
  appearance: appearanceStyleSpec,
};

export const STYLE_SPEC_KEYS = Object.keys(STYLE_SPECS);

export const isStyleRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');

export const getStyleSpec = (key?: string): StyleSpec | undefined =>
  key ? STYLE_SPECS[key] : undefined;
