import { isStyle } from '../component';
import { type Head, isHead, headDefaults } from './head';
import { type GridLayout, type Frame, isGridLayout, isFrame } from './frame';

export type { MetaTag, Head } from './head';
export { headDefaults, isHead } from './head';
export type { GridLayout, Placement, FrameRef, Frame, ListFrame, CanvasFrame, EditorFrame } from './frame';
export { isGridLayout, isPlacement, isFrameRef, isFrame, isListFrame, isCanvasFrame, isEditorFrame } from './frame';
export type { EditorComponent, EditorSection, FieldStyleConfig } from './kind/component-editor';
export { isEditorComponent, editorDefaults, editorSchema } from './kind/component-editor';

export type Screen = {
  head: Head;
  shell?: Record<string, string>;
  grid: GridLayout;
  frames: Frame[];
};

export const isScreen = (value: unknown): value is Screen => {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<Screen>;
  return (
    isHead(c.head) &&
    (c.shell === undefined || isStyle(c.shell)) &&
    isGridLayout(c.grid) &&
    Array.isArray(c.frames) &&
    c.frames.every(isFrame)
  );
};

export const screenDefaults: Screen = {
  head: headDefaults,
  shell: { width: '100%', height: '100%' },
  grid: { kind: 'grid', columns: 120, rows: 120 },
  frames: [],
};
