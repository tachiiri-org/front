import type { TreeNode } from '../../../../schema/component/kind/tree-editor';

export interface DefinitionEditorState {
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

export interface DefinitionEditorContext {
  id: string;
  outer: HTMLElement;
  sourceComponentId: string | undefined;
  state: DefinitionEditorState;
  scheduleSave: () => void;
  pushHistory: () => void;
  render: () => void;
}
