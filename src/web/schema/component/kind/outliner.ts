import { ALL_CSS_PROP_KEYS } from '../style';
import type { CssStyleProps } from '../style';
import type { SchemaField } from './form/field';
import type { TreeEditorData, TreeEditorSource } from './tree-editor';

export type OutlinerComponent = {
  kind: 'outliner';
  name?: string;
  data: TreeEditorData;
  source?: TreeEditorSource;
  targetComponentId?: string;
  sourceComponentId?: string;
} & CssStyleProps;

export const outlinerDefaults: OutlinerComponent = {
  kind: 'outliner',
  name: '',
  data: { nodes: [] },
};

export const outlinerSchema: SchemaField[] = [
  { kind: 'text-field', key: 'name', label: 'name' },
  { kind: 'text-field', key: 'targetComponentId', label: 'targetComponentId' },
];

const isTreeNode = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.text === 'string' &&
    (c.children === undefined || (Array.isArray(c.children) && (c.children as unknown[]).every(isTreeNode)))
  );
};

export const isOutlinerComponent = (value: unknown): value is OutlinerComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.kind !== 'outliner') return false;
  if (c.name !== undefined && typeof c.name !== 'string') return false;
  if (typeof c.data !== 'object' || c.data === null || Array.isArray(c.data)) return false;
  const data = c.data as Record<string, unknown>;
  if (!Array.isArray(data.nodes) || !(data.nodes as unknown[]).every(isTreeNode)) return false;
  if (c.source !== undefined) {
    if (typeof c.source !== 'object' || c.source === null || Array.isArray(c.source)) return false;
    const src = c.source as Record<string, unknown>;
    if (typeof src.url !== 'string') return false;
    if (src.itemsPath !== undefined && typeof src.itemsPath !== 'string') return false;
  }
  if (c.targetComponentId !== undefined && typeof c.targetComponentId !== 'string') return false;
  if (c.sourceComponentId !== undefined && typeof c.sourceComponentId !== 'string') return false;
  return ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string');
};
