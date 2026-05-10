import { isStyleRecord } from '../component';
import { type Head, isHead, headDefaults } from './head';
import { type GridLayout, type Frame, isGridLayout, isFrame } from './frame';
import { STYLE_SPEC_KEYS } from '../component/style';

export type { MetaTag, Head } from './head';
export { headDefaults, isHead } from './head';
export type { GridLayout, Placement, FrameRef, Frame, ListFrame, CanvasFrame, EditorFrame } from './frame';
export { isGridLayout, isPlacement, isFrameRef, isFrame, isListFrame, isCanvasFrame, isEditorFrame } from './frame';

export type Screen = {
  head: Head;
  sizing?: Record<string, string>;
  layout?: Record<string, string>;
  appearance?: Record<string, string>;
  padding?: Record<string, string>;
  margin?: Record<string, string>;
  grid: GridLayout;
  frames: Frame[];
};

export const isScreen = (value: unknown): value is Screen => {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<Screen>;
  return (
    isHead(c.head) &&
    STYLE_SPEC_KEYS.every((k) => (c as Record<string, unknown>)[k] === undefined || isStyleRecord((c as Record<string, unknown>)[k])) &&
    isGridLayout(c.grid) &&
    Array.isArray(c.frames) &&
    c.frames.every(isFrame)
  );
};

export const screenDefaults: Screen = {
  head: headDefaults,
  sizing: { width: '100%', height: '100%' },
  grid: { kind: 'grid', columns: 120, rows: 120 },
  frames: [],
};
