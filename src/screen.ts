import { type Component, isComponent, isStyle } from './component';
import type { ListComponent } from './component/kind/list';
import type { CanvasComponent } from './component/kind/canvas';
import type { EditorComponent } from './component/kind/editor';
import { isListComponent } from './component/kind/list';
import { isCanvasComponent } from './component/kind/canvas';
import { isEditorComponent } from './component/kind/editor';
import { type Head, isHead, headDefaults } from './head';

export type { MetaTag, Head } from './head';

export type GridLayout = {
  kind: 'grid';
  columns: number;
  rows?: number;
};

export type Placement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FrameRef = {
  id: string;
  kind: string;
  src: string;
  placement: Placement;
};

export type Frame = FrameRef | ({ id: string; placement: Placement } & Component);

export type ListFrame = { id: string; placement: Placement } & ListComponent;
export type CanvasFrame = { id: string; placement: Placement } & CanvasComponent;
export type EditorFrame = { id: string; placement: Placement } & EditorComponent;

export type Screen = {
  head: Head;
  shell: Record<string, string>;
  grid: GridLayout;
  frames: Frame[];
};

export const isGridLayout = (value: unknown): value is GridLayout => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'grid' &&
    typeof c.columns === 'number' &&
    Number.isInteger(c.columns) &&
    c.columns > 0 &&
    (c.rows === undefined || (
      typeof c.rows === 'number' &&
      Number.isInteger(c.rows) &&
      c.rows > 0
    ))
  );
};

export const isPlacement = (value: unknown): value is Placement => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.x === 'number' && Number.isInteger(c.x) && c.x > 0 &&
    typeof c.y === 'number' && Number.isInteger(c.y) && c.y > 0 &&
    typeof c.width === 'number' && Number.isInteger(c.width) && c.width > 0 &&
    typeof c.height === 'number' && Number.isInteger(c.height) && c.height > 0
  );
};

export const isFrameRef = (value: unknown): value is FrameRef => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.kind === 'string' &&
    typeof c.src === 'string' &&
    isPlacement(c.placement) &&
    !isComponent(value)
  );
};

export const isFrame = (value: unknown): value is Frame => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.id !== 'string' || !isPlacement(c.placement)) return false;
  if (typeof c.src === 'string') return typeof c.kind === 'string';
  return isComponent(value);
};

export const isScreen = (value: unknown): value is Screen => {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<Screen>;
  return (
    isHead(c.head) &&
    isStyle(c.shell) &&
    isGridLayout(c.grid) &&
    Array.isArray(c.frames) &&
    c.frames.every(isFrame)
  );
};

export const isListFrame = (f: Frame): f is ListFrame => isListComponent(f);
export const isCanvasFrame = (f: Frame): f is CanvasFrame => isCanvasComponent(f);
export const isEditorFrame = (f: Frame): f is EditorFrame => isEditorComponent(f);

export const screenDefaults: Screen = {
  head: headDefaults,
  shell: { width: '100%', height: '100%' },
  grid: { kind: 'grid', columns: 120, rows: 120 },
  frames: [],
};
