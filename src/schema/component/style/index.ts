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

export const STYLE_MAP_KEYS = [
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'display',
  'gap',
  'flex',
  'flexDirection',
  'alignItems',
  'justifyContent',
  'textAlign',
  'fontSize',
  'fontWeight',
  'color',
  'background',
  'backgroundColor',
  'border',
  'borderRadius',
  'boxShadow',
  'overflow',
  'overflowX',
  'overflowY',
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'cursor',
  'whiteSpace',
  'opacity',
  'transform',
  'transformOrigin',
  'userSelect',
  'pointerEvents',
  'lineHeight',
] as const;

export const isStyleRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');

export const getStyleSpec = (key?: string): StyleSpec | undefined =>
  key ? STYLE_SPECS[key] : undefined;
