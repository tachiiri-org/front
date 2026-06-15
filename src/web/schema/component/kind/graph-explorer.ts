import type { SchemaField } from './form/field';

export type GraphExplorerComponent = {
  kind: 'graph-explorer';
  graphId: string;
  lang?: 'en' | 'ja';
  limit?: number;
};

export const graphExplorerDefaults: GraphExplorerComponent = {
  kind: 'graph-explorer',
  graphId: '',
  lang: 'ja',
  limit: 100,
};

export const graphExplorerSchema: SchemaField[] = [
  { kind: 'text-field', key: 'graphId', label: 'graphId' },
  { kind: 'text-field', key: 'lang', label: 'lang (en | ja)' },
  { kind: 'text-field', key: 'limit', label: 'limit' },
];

export const isGraphExplorerComponent = (value: unknown): value is GraphExplorerComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.kind !== 'graph-explorer') return false;
  if (typeof c.graphId !== 'string') return false;
  if (c.lang !== undefined && c.lang !== 'en' && c.lang !== 'ja') return false;
  if (c.limit !== undefined && typeof c.limit !== 'number') return false;
  return true;
};
