import { type Head, isHead, headDefaults } from './head';
import { type GridLayout, type Frame, isGridLayout, isFrame } from './frame';
import { CSS_PROP_KEYS, type CssStyleProps } from '../component/style';

export type { MetaTag, Head } from './head';
export { headDefaults, isHead } from './head';
export type { GridLayout, Placement, FrameRef, Frame, ListFrame, CanvasFrame, EditorFrame } from './frame';
export { isGridLayout, isPlacement, isFrameRef, isFrame, isListFrame, isCanvasFrame, isEditorFrame } from './frame';

export type Screen = {
  head: Head;
  grid: GridLayout;
  frames: Frame[];
} & CssStyleProps;

export const isScreen = (value: unknown): value is Screen => {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    isHead(c.head) &&
    CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string') &&
    isGridLayout(c.grid) &&
    Array.isArray(c.frames) &&
    c.frames.every(isFrame)
  );
};

export const screenDefaults: Screen = {
  head: headDefaults,
  width: '100%',
  height: '100%',
  grid: { kind: 'grid', columns: 120, rows: 120 },
  frames: [],
};
