import { isStyle } from './validator';

export type GridCanvasComponent = {
  kind: 'grid-canvas';
  targetComponentId?: string;
  style?: Record<string, string>;
  cellStyle?: Record<string, string>;
};

export const isGridCanvasComponent = (value: unknown): value is GridCanvasComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'grid-canvas' &&
    (c.targetComponentId === undefined || typeof c.targetComponentId === 'string') &&
    (c.style === undefined || isStyle(c.style)) &&
    (c.cellStyle === undefined || isStyle(c.cellStyle))
  );
};
