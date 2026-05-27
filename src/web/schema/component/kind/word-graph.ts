import { ALL_CSS_PROP_KEYS } from '../style';
import type { CssStyleProps } from '../style';
import type { SchemaField } from './form/field';

export type GraphWord = {
  id: string;
  text: string;
  color?: string;
};

export type GraphText = {
  id: string;
  text: string;
  wordIds: string[];
};

export type WordGraphComponent = {
  kind: 'word-graph';
  name?: string;
  data: { texts: GraphText[]; words: GraphWord[] };
  source?: { url: string };
} & CssStyleProps;

export const wordGraphDefaults: WordGraphComponent = {
  kind: 'word-graph',
  name: '',
  data: { texts: [], words: [] },
};

export const wordGraphSchema: SchemaField[] = [
  { kind: 'text-field', key: 'name', label: 'name' },
];

const isGraphWord = (v: unknown): boolean => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return typeof c.id === 'string' && typeof c.text === 'string';
};

const isGraphText = (v: unknown): boolean => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.text === 'string' &&
    Array.isArray(c.wordIds) &&
    (c.wordIds as unknown[]).every((id) => typeof id === 'string')
  );
};

export const isWordGraphComponent = (value: unknown): value is WordGraphComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.kind !== 'word-graph') return false;
  if (c.name !== undefined && typeof c.name !== 'string') return false;
  if (typeof c.data !== 'object' || c.data === null || Array.isArray(c.data)) return false;
  const data = c.data as Record<string, unknown>;
  if (!Array.isArray(data.texts) || !(data.texts as unknown[]).every(isGraphText)) return false;
  if (!Array.isArray(data.words) || !(data.words as unknown[]).every(isGraphWord)) return false;
  if (c.source !== undefined) {
    if (typeof c.source !== 'object' || c.source === null || Array.isArray(c.source)) return false;
    const src = c.source as Record<string, unknown>;
    if (typeof src.url !== 'string') return false;
  }
  return ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string');
};
