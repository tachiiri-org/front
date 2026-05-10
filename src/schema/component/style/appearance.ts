import { makeStyleEntry } from './shared';
import type { StyleSpec } from './types';

export const appearanceStyleSpec: StyleSpec = {
  key: 'appearance',
  label: 'appearance',
  entries: [
    makeStyleEntry('fontSize', 'fontSize', 'font-size', '12px'),
    makeStyleEntry('fontWeight', 'fontWeight', 'font-weight'),
    makeStyleEntry('lineHeight', 'lineHeight', 'line-height'),
    makeStyleEntry('color', 'color'),
    makeStyleEntry('background', 'background'),
    makeStyleEntry('backgroundColor', 'backgroundColor', 'background-color'),
    makeStyleEntry('border', 'border'),
    makeStyleEntry('borderRadius', 'borderRadius', 'border-radius'),
    makeStyleEntry('boxShadow', 'boxShadow', 'box-shadow'),
    makeStyleEntry('opacity', 'opacity'),
    makeStyleEntry('cursor', 'cursor'),
  ],
};
