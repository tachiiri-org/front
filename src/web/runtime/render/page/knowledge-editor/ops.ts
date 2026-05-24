import type { TreeNode } from '../../../../schema/component/kind/tree-editor';
import { ALL_CSS_PROP_KEYS } from '../../../../schema/component';

export const getByPath = (obj: unknown, path: string): unknown => {
  if (!path) return obj;
  return path.split('.').reduce((acc, key) => {
    if (acc !== null && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
};

export const applyCssProps = (el: HTMLElement, c: Record<string, unknown>): void => {
  for (const propKey of ALL_CSS_PROP_KEYS) {
    const v = c[propKey];
    if (typeof v === 'string') (el.style as unknown as Record<string, string>)[propKey] = v;
  }
};

export const randomId = (): string => {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  return `node_${Math.random().toString(36).slice(2, 10)}`;
};

export const cloneNodes = (nodes: TreeNode[]): TreeNode[] =>
  JSON.parse(JSON.stringify(nodes)) as TreeNode[];

export const flatIds = (nodes: TreeNode[]): string[] => {
  const ids: string[] = [];
  const traverse = (list: TreeNode[]): void => {
    for (const n of list) {
      ids.push(n.id);
      if (n.children?.length) traverse(n.children);
    }
  };
  traverse(nodes);
  return ids;
};

export type NodeLocation = { parent: TreeNode[]; index: number };

export const findNode = (nodes: TreeNode[], id: string): NodeLocation | null => {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { parent: nodes, index: i };
    const children = nodes[i].children;
    if (children) {
      const found = findNode(children, id);
      if (found) return found;
    }
  }
  return null;
};

export const findDedentTarget = (list: TreeNode[], id: string, parentList: TreeNode[] | null = null, parentItemIndex = -1): NodeLocation | null => {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      if (parentList !== null) return { parent: parentList, index: parentItemIndex };
      return null;
    }
    const children = list[i].children;
    if (children) {
      const found = findDedentTarget(children, id, list, i);
      if (found) return found;
    }
  }
  return null;
};

export const getAncestors = (id: string, list: TreeNode[], ancestors: string[] = []): string[] | null => {
  for (const n of list) {
    if (n.id === id) return ancestors;
    if (n.children) {
      const found = getAncestors(id, n.children, [...ancestors, n.id]);
      if (found !== null) return found;
    }
  }
  return null;
};

export const reassignIds = (nodeList: TreeNode[]): TreeNode[] =>
  nodeList.map(n => ({
    ...n,
    id: randomId(),
    children: n.children?.length ? reassignIds(n.children) : n.children,
  }));

export const hasDescendants = (node: TreeNode): { issue: boolean; proposed: boolean } => {
  let issue = false, proposed = false;
  const check = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.type === 'issue' || n.text.startsWith('?')) issue = true;
      else if (n.status === 'proposed') proposed = true;
      if (n.children?.length) check(n.children);
    }
  };
  check(node.children ?? []);
  return { issue, proposed };
};

export const dispatchNodeFocus = (knowledgeEditorFrameId: string, nodeId: string, nodeText: string): void => {
  document.dispatchEvent(new CustomEvent('knowledge-editor:node-focus', {
    detail: { knowledgeEditorFrameId, nodeId, nodeText },
  }));
};

export const dispatchNodeTextChange = (knowledgeEditorFrameId: string, nodeId: string, nodeText: string): void => {
  document.dispatchEvent(new CustomEvent('knowledge-editor:node-text-change', {
    detail: { knowledgeEditorFrameId, nodeId, nodeText },
  }));
};

export const updateNodeSelectionVisuals = (
  container: HTMLElement,
  allIds: string[],
  anchorIdx: number | null,
  activeIdx: number | null,
): void => {
  const lo = anchorIdx !== null && activeIdx !== null ? Math.min(anchorIdx, activeIdx) : -1;
  const hi = anchorIdx !== null && activeIdx !== null ? Math.max(anchorIdx, activeIdx) : -1;
  const rows = container.querySelectorAll<HTMLElement>('[data-node-row]');
  for (const row of rows) {
    const idx = allIds.indexOf(row.dataset.nodeRow ?? '');
    if (lo >= 0 && idx >= lo && idx <= hi) {
      row.style.background = 'rgba(0, 120, 255, 0.12)';
    } else {
      row.style.background = row.dataset.inPath === 'true' ? 'rgba(0, 120, 255, 0.08)' : 'transparent';
    }
  }
};
