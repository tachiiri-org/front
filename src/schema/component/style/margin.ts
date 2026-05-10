import { makeStyleEntry } from './shared';
import type { StyleSpec } from './types';

export const marginStyleSpec: StyleSpec = {
  key: 'margin',
  label: 'margin',
  entries: [
    makeStyleEntry('mx', ['marginLeft', 'marginRight'], '-mx', '12px'),
    makeStyleEntry('my', ['marginTop', 'marginBottom'], '-my', '12px'),
    makeStyleEntry('mt', 'marginTop', '-mt', '12px'),
    makeStyleEntry('mr', 'marginRight', '-mr', '12px'),
    makeStyleEntry('mb', 'marginBottom', '-mb', '12px'),
    makeStyleEntry('ml', 'marginLeft', '-ml', '12px'),
  ],
};
