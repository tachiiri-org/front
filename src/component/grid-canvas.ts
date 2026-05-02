import { isStyle } from './validator';

export type GridCanvasComponent = {
  kind: 'grid-canvas';
  targetComponentId?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  style?: Record<string, string>;
  cellStyle?: Record<string, string>;
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export const isGridCanvasComponent = (value: unknown): value is GridCanvasComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'grid-canvas' &&
    (c.targetComponentId === undefined || typeof c.targetComponentId === 'string') &&
    (c.viewportWidth === undefined || isPositiveInteger(c.viewportWidth)) &&
    (c.viewportHeight === undefined || isPositiveInteger(c.viewportHeight)) &&
    (c.style === undefined || isStyle(c.style)) &&
    (c.cellStyle === undefined || isStyle(c.cellStyle))
  );
};
