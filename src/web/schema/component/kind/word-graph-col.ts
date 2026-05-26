import { ALL_CSS_PROP_KEYS } from '../style';
import type { CssStyleProps } from '../style';
import type { SchemaField } from './form/field';

export type WordGraphTextColComponent = {
  kind: 'word-graph-text-col';
  graphId: string;
  colIndex: 0 | 2;
  name?: string;
} & CssStyleProps;

export type WordGraphWordColComponent = {
  kind: 'word-graph-word-col';
  graphId: string;
  name?: string;
} & CssStyleProps;

export const wordGraphTextColDefaults: WordGraphTextColComponent = {
  kind: 'word-graph-text-col',
  graphId: '',
  colIndex: 0,
};

export const wordGraphWordColDefaults: WordGraphWordColComponent = {
  kind: 'word-graph-word-col',
  graphId: '',
};

export const wordGraphTextColSchema: SchemaField[] = [
  { kind: 'text-field', key: 'graphId', label: 'graphId' },
  { kind: 'text-field', key: 'colIndex', label: 'colIndex' },
];

export const wordGraphWordColSchema: SchemaField[] = [
  { kind: 'text-field', key: 'graphId', label: 'graphId' },
];

export const isWordGraphTextColComponent = (value: unknown): value is WordGraphTextColComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'word-graph-text-col' &&
    typeof c.graphId === 'string' &&
    (c.colIndex === 0 || c.colIndex === 2) &&
    ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string')
  );
};

export const isWordGraphWordColComponent = (value: unknown): value is WordGraphWordColComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    c.kind === 'word-graph-word-col' &&
    typeof c.graphId === 'string' &&
    ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string')
  );
};
