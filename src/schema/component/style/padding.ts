import { makeStyleEntry } from './shared';
import type { StyleSpec } from './types';

export const paddingStyleSpec: StyleSpec = {
  key: 'padding',
  label: 'padding',
  entries: [
    makeStyleEntry('px', ['paddingLeft', 'paddingRight'], '-px', '12px'),
    makeStyleEntry('py', ['paddingTop', 'paddingBottom'], '-py', '12px'),
    makeStyleEntry('pt', 'paddingTop', '-pt', '12px'),
    makeStyleEntry('pr', 'paddingRight', '-pr', '12px'),
    makeStyleEntry('pb', 'paddingBottom', '-pb', '12px'),
    makeStyleEntry('pl', 'paddingLeft', '-pl', '12px'),
  ],
};
