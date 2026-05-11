import { makeStyleEntry } from './shared';
import type { StyleSpec } from './types';

export const paddingStyleSpec: StyleSpec = {
  key: 'padding',
  label: 'padding',
  entries: [
    makeStyleEntry('t', 'padding-top', 'T', undefined, '0'),
    makeStyleEntry('r', 'padding-right', 'R', undefined, '0'),
    makeStyleEntry('b', 'padding-bottom', 'B', undefined, '0'),
    makeStyleEntry('l', 'padding-left', 'L', undefined, '0'),
  ],
};
