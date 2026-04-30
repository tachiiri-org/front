import { type Component, isComponent, isStyle } from './component';
import type { ScreenListComponent } from './component/screen-list';
import type { GridCanvasComponent } from './component/grid-canvas';
import type { EditorComponent } from './component/editor';
import { isScreenListComponent } from './component/screen-list';
import { isGridCanvasComponent } from './component/grid-canvas';
import { isEditorComponent } from './component/editor';

export type MetaTag = {
  name: string;
  content: string;
};

export type Head = {
  title: string;
  meta: MetaTag[];
};

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

export type ScreenListFrame = { id: string; placement: Placement } & ScreenListComponent;
export type GridCanvasFrame = { id: string; placement: Placement } & GridCanvasComponent;
export type EditorFrame = { id: string; placement: Placement } & EditorComponent;

export type Screen = {
  head: Head;
  shell: Record<string, string>;
  grid: GridLayout;
  frames: Frame[];
};

const isMetaTag = (value: unknown): value is MetaTag => {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Partial<MetaTag>;
  return typeof m.name === 'string' && typeof m.content === 'string';
};

const isHead = (value: unknown): value is Head => {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<Head>;
  return (
    typeof c.title === 'string' &&
    Array.isArray(c.meta) &&
    c.meta.every(isMetaTag)
  );
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
    isPlacement(c.placement)
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

export const isScreenListFrame = (f: Frame): f is ScreenListFrame => isScreenListComponent(f);
export const isGridCanvasFrame = (f: Frame): f is GridCanvasFrame => isGridCanvasComponent(f);
export const isEditorFrame = (f: Frame): f is EditorFrame => isEditorComponent(f);
