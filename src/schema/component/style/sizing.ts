import { makeStyleEntry } from './shared';
import type { StyleSpec } from './types';

export const sizingStyleSpec: StyleSpec = {
  key: 'sizing',
  label: 'sizing',
  entries: [
    makeStyleEntry('width', 'width'),
    makeStyleEntry('height', 'height'),
    makeStyleEntry('minWidth', 'minWidth', 'min-width'),
    makeStyleEntry('minHeight', 'minHeight', 'min-height'),
    makeStyleEntry('maxWidth', 'maxWidth', 'max-width'),
    makeStyleEntry('maxHeight', 'maxHeight', 'max-height'),
    makeStyleEntry('overflow', 'overflow'),
    makeStyleEntry('overflowX', 'overflowX', 'overflow-x'),
    makeStyleEntry('overflowY', 'overflowY', 'overflow-y'),
    makeStyleEntry('position', 'position'),
    makeStyleEntry('inset', 'inset'),
    makeStyleEntry('top', 'top'),
    makeStyleEntry('right', 'right'),
    makeStyleEntry('bottom', 'bottom'),
    makeStyleEntry('left', 'left'),
    makeStyleEntry('transform', 'transform'),
    makeStyleEntry('transformOrigin', 'transformOrigin', 'transform-origin'),
  ],
};
