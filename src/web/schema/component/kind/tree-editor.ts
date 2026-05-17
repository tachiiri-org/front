import { ALL_CSS_PROP_KEYS } from '../style';
import type { CssStyleProps } from '../style';
import type { SchemaField } from './form/field';

export type TreeNode = {
  id: string;
  text: string;
  children?: TreeNode[];
};

export type TreeEditorData = {
  nodes: TreeNode[];
};

export type TreeEditorComponent = {
  kind: 'tree-editor';
  name?: string;
  data: TreeEditorData;
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
  return ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string');
};
