import { makeStyleEntry } from './shared';
import type { StyleSpec } from './types';

export const marginStyleSpec: StyleSpec = {
  key: 'margin',
  label: 'margin',
  entries: [
    makeStyleEntry('t', 'marginTop', 'T', undefined, '0'),
    makeStyleEntry('r', 'marginRight', 'R', undefined, '0'),
    makeStyleEntry('b', 'marginBottom', 'B', undefined, '0'),
    makeStyleEntry('l', 'marginLeft', 'L', undefined, '0'),
  ],
};
