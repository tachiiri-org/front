import type { SchemaField } from './form/field';

export type GraphEditorComponent = {
  kind: 'graph-editor' | 'graph-explorer';
  graphId: string;
  lang?: 'en' | 'ja';
  limit?: number;
  rootNodeId?: string;
};

export const graphEditorDefaults: GraphEditorComponent = {
  kind: 'graph-editor',
  graphId: '',
  lang: 'ja',
  limit: 100,
};

export const graphEditorSchema: SchemaField[] = [
  { kind: 'text-field', key: 'graphId', label: 'graphId' },
  { kind: 'text-field', key: 'lang', label: 'lang (en | ja)' },
  { kind: 'text-field', key: 'limit', label: 'limit' },
  { kind: 'text-field', key: 'rootNodeId', label: 'rootNodeId (optional)' },
];

export const isGraphEditorComponent = (value: unknown): value is GraphEditorComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.kind !== 'graph-editor' && c.kind !== 'graph-explorer') return false;
  if (typeof c.graphId !== 'string') return false;
  if (c.lang !== undefined && c.lang !== 'en' && c.lang !== 'ja') return false;
  if (c.limit !== undefined && typeof c.limit !== 'number') return false;
  if (c.rootNodeId !== undefined && typeof c.rootNodeId !== 'string') return false;
  return true;
};
