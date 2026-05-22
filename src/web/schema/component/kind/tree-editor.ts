import { ALL_CSS_PROP_KEYS } from '../style';
import type { CssStyleProps } from '../style';
import type { SchemaField } from './form/field';

export type TreeNode = {
  id: string;
  text: string;
  children?: TreeNode[];
  status?: 'accepted' | 'proposed';
  type?: 'knowledge' | 'issue';
  proposedAt?: string;
  proposedBy?: string;
};

export type TreeEditorData = {
  nodes: TreeNode[];
};

export type TreeEditorSource = {
  url: string;
  itemsPath?: string;
};

export type TreeEditorComponent = {
  kind: 'tree-editor';
  name?: string;
  data: TreeEditorData;
  source?: TreeEditorSource;
} & CssStyleProps;

const isTreeNode = (value: unknown): value is TreeNode => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.text === 'string' &&
    (c.children === undefined || (Array.isArray(c.children) && (c.children as unknown[]).every(isTreeNode)))
  );
};

export const treeEditorDefaults: TreeEditorComponent = {
  kind: 'tree-editor',
  name: '',
  data: { nodes: [] },
};

export const treeEditorSchema: SchemaField[] = [
  { kind: 'text-field', key: 'name', label: 'name' },
];

export const isTreeEditorComponent = (value: unknown): value is TreeEditorComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.kind !== 'tree-editor') return false;
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
  return ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string');
};
