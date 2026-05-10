import { makeStyleEntry } from './shared';
import type { StyleSpec } from './types';

export const layoutStyleSpec: StyleSpec = {
  key: 'layout',
  label: 'layout',
  entries: [
    makeStyleEntry('display', 'display', 'display'),
    makeStyleEntry('gap', 'gap', 'gap', '8px'),
    makeStyleEntry('flex', 'flex', 'flex'),
    makeStyleEntry('flexDirection', 'flexDirection', 'flex-direction'),
    makeStyleEntry('alignItems', 'alignItems', 'align-items'),
    makeStyleEntry('justifyContent', 'justifyContent', 'justify-content'),
    makeStyleEntry('textAlign', 'textAlign', 'text-align'),
    makeStyleEntry('whiteSpace', 'whiteSpace', 'white-space'),
    makeStyleEntry('userSelect', 'userSelect', 'user-select'),
    makeStyleEntry('pointerEvents', 'pointerEvents', 'pointer-events'),
  ],
};
