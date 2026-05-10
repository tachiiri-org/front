import { makeStyleEntry } from './shared';
import type { StyleSpec } from './types';

export const spacingStyleSpec: StyleSpec = {
  key: 'spacing',
  label: 'spacing',
  entries: [
    makeStyleEntry('px', ['paddingLeft', 'paddingRight'], '-px', '12px'),
    makeStyleEntry('py', ['paddingTop', 'paddingBottom'], '-py', '12px'),
    makeStyleEntry('pt', 'paddingTop', '-pt', '12px'),
    makeStyleEntry('pr', 'paddingRight', '-pr', '12px'),
    makeStyleEntry('pb', 'paddingBottom', '-pb', '12px'),
    makeStyleEntry('pl', 'paddingLeft', '-pl', '12px'),
    makeStyleEntry('mx', ['marginLeft', 'marginRight'], '-mx', '12px'),
    makeStyleEntry('my', ['marginTop', 'marginBottom'], '-my', '12px'),
    makeStyleEntry('mt', 'marginTop', '-mt', '12px'),
    makeStyleEntry('mr', 'marginRight', '-mr', '12px'),
    makeStyleEntry('mb', 'marginBottom', '-mb', '12px'),
    makeStyleEntry('ml', 'marginLeft', '-ml', '12px'),
  ],
};
