export type { StyleEntrySpec, StyleSpec, StyleValueTarget } from './types';
export { readStyleValue, writeStyleValue, deleteStyleValue, makeStyleEntry } from './shared';
export { spacingStyleSpec } from './spacing';
export { paddingStyleSpec } from './padding';
export { marginStyleSpec } from './margin';
export { layoutStyleSpec } from './layout';
export { appearanceStyleSpec } from './appearance';
export { sizingStyleSpec } from './sizing';
export { shellStyleSpec } from './shell';

import { appearanceStyleSpec } from './appearance';
import { marginStyleSpec } from './margin';
import { layoutStyleSpec } from './layout';
import { paddingStyleSpec } from './padding';
import { shellStyleSpec } from './shell';
import { sizingStyleSpec } from './sizing';
import { spacingStyleSpec } from './spacing';
import type { StyleSpec } from './types';

export const STYLE_SPECS: Record<string, StyleSpec> = {
  shell: shellStyleSpec,
  padding: paddingStyleSpec,
  margin: marginStyleSpec,
  spacing: spacingStyleSpec,
  sizing: sizingStyleSpec,
  layout: layoutStyleSpec,
  appearance: appearanceStyleSpec,
};

export const getStyleSpec = (key?: string): StyleSpec | undefined =>
  key ? STYLE_SPECS[key] : undefined;
