import type { FormField } from './form/field';

const isStyle = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((x) => typeof x === 'string');

export type CanvasComponent = {
  kind: 'canvas';
  name?: string;
  padding?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  style?: Record<string, string>;
  cellStyle?: Record<string, string>;
};

export const canvasDefaults: CanvasComponent = {
  kind: 'canvas',
  name: '',
  padding: '',
  viewportWidth: 1200,
  viewportHeight: 800,
  style: {},
  cellStyle: {},
};

export const canvasSchema: FormField[] = [
  { kind: 'text-field', key: 'padding', label: 'padding' },
  { kind: 'number-field', key: 'viewportWidth', label: 'viewportWidth' },
  { kind: 'number-field', key: 'viewportHeight', label: 'viewportHeight' },
  { kind: 'style-map-field', key: 'style', label: 'style' },
  { kind: 'style-map-field', key: 'cellStyle', label: 'cellStyle' },
];

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export const isCanvasComponent = (value: unknown): value is CanvasComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'canvas' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.padding === undefined || typeof c.padding === 'string') &&
    (c.viewportWidth === undefined || isPositiveInteger(c.viewportWidth)) &&
    (c.viewportHeight === undefined || isPositiveInteger(c.viewportHeight)) &&
    (c.style === undefined || isStyle(c.style)) &&
    (c.cellStyle === undefined || isStyle(c.cellStyle))
  );
};
