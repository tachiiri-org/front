const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

export type CanvasComponent = {
  kind: 'canvas';
  targetComponentId?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  style?: Record<string, string>;
  cellStyle?: Record<string, string>;
};

export const canvasDefaults: CanvasComponent = {
  kind: 'canvas',
  targetComponentId: '',
  viewportWidth: 1200,
  viewportHeight: 800,
  style: {},
  cellStyle: {},
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export const isCanvasComponent = (value: unknown): value is CanvasComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'canvas' &&
    (c.targetComponentId === undefined || typeof c.targetComponentId === 'string') &&
    (c.viewportWidth === undefined || isPositiveInteger(c.viewportWidth)) &&
    (c.viewportHeight === undefined || isPositiveInteger(c.viewportHeight)) &&
    (c.style === undefined || isStyle(c.style)) &&
    (c.cellStyle === undefined || isStyle(c.cellStyle))
  );
};
