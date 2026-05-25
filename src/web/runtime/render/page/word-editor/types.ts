import type { TreeNode } from './ops';

export interface WordEditorState {
  nodes: TreeNode[];
  pendingFocusId: string | null;
  focusedNodeId: string | null;
  saveTimer: ReturnType<typeof setTimeout> | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  rafId: number | null;
  anchorIdx: number | null;
  activeIdx: number | null;
  mousedownNodeId: string | null;
  pendingSelectionStart: number | null;
  resolvedTreeId: string | undefined;
  clipboard: TreeNode[] | null;
  history: TreeNode[][];
  inputCache: Map<string, HTMLTextAreaElement>;
  activeDocNodeId: string | null;
  docContentCache: Map<string, string>;
}

export interface WordEditorContext {
  id: string;
  outer: HTMLElement;
  state: WordEditorState;
  scheduleSave: () => void;
  pushHistory: () => void;
  render: () => void;
  scheduleRender: () => void;
  fetchDocContent: (nodeId: string) => void;
  syncOuterWidth: () => void;
}
