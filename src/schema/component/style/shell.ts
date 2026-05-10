import { appearanceStyleSpec } from './appearance';
import { layoutStyleSpec } from './layout';
import { makeStyleEntry } from './shared';
import { marginStyleSpec } from './margin';
import { paddingStyleSpec } from './padding';
import { sizingStyleSpec } from './sizing';
import type { StyleSpec } from './types';

export const shellStyleSpec: StyleSpec = {
  key: 'shell',
  label: 'shell',
  entries: [
    ...sizingStyleSpec.entries,
    ...layoutStyleSpec.entries,
    ...appearanceStyleSpec.entries,
    ...paddingStyleSpec.entries,
    ...marginStyleSpec.entries,
  ],
};
