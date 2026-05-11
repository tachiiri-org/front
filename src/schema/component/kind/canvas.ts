import type { SchemaField } from './form/field';
import { CSS_PROP_KEYS, isStyleRecord, type CssStyleProps } from '../style';
import canvasSchemaJson from './canvas.schema.json';

export type CanvasComponent = {
  kind: 'canvas';
  name?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  cellStyle?: Record<string, string>;
} & CssStyleProps;

export const canvasDefaults: CanvasComponent = {
  kind: 'canvas',
  name: '',
  viewportWidth: 1200,
  viewportHeight: 800,
};

export const canvasSchema = canvasSchemaJson as SchemaField[];

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export const isCanvasComponent = (value: unknown): value is CanvasComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'canvas' &&
    (c.name === undefined || typeof c.name === 'string') &&
    (c.viewportWidth === undefined || isPositiveInteger(c.viewportWidth)) &&
    (c.viewportHeight === undefined || isPositiveInteger(c.viewportHeight)) &&
    (c.cellStyle === undefined || isStyleRecord(c.cellStyle)) &&
    CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string')
  );
};
