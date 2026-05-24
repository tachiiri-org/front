import type { TreeNode } from '../../../../schema/component/kind/tree-editor';

export interface DocumentEditorState {
  nodes: TreeNode[];
  pendingFocusId: string | null;
  pendingFocusCursorPos: number | null;
  focusedNodeId: string | null;
  saveTimer: ReturnType<typeof setTimeout> | null;
  anchorIdx: number | null;
  activeIdx: number | null;
  resolvedTreeId: string | undefined;
  clipboard: TreeNode[] | null;
  history: TreeNode[][];
  collapsedIds: Set<string>;
}

export interface DocumentEditorContext {
  id: string;
  outer: HTMLElement;
  sourceComponentId: string | undefined;
  state: DocumentEditorState;
  scheduleSave: () => void;
  pushHistory: () => void;
  render: () => void;
}
