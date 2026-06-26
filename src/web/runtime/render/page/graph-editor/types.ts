export type ExplorerNode = { id: string; en?: string; ja?: string; color?: string; properties?: Record<string, string> };

// Cross-pane drag state for the multi-pane (パネル) view. Each pane is an independent
// outliner instance with its own closure scope, so the source pane records the dragged
// node(s) here on dragstart and the target pane reads them on drop — letting a node be
// dragged from one pane and dropped into another.
export type PaneDragState = {
  // Identity of the source pane (object reference). Lets the drop target tell whether
  // the drag started in the same pane (use its local tree logic) or a different one.
  sourceToken: object;
  // Node ids at dragstart — used for self-drop / subtree guards during dragover.
  nodeIds: string[];
  // The dragged nodes with the parent each had at dragstart (for link toggling).
  movers: { node: ExplorerNode; oldParentId: string | null }[];
  // Remove the moved nodes from the source pane's local tree and re-render it.
  detachFromSource: (nodes: ExplorerNode[]) => void;
  // Resolves once every dragged node has a real (non-temp) id, so cross-pane API
  // calls never send a temp id to the backend.
  awaitRealIds: () => Promise<void>;
};

export type ExplorerState = {
  graphId: string;
  lang: 'en' | 'ja';
  limit: number;
  bookmarks: Set<string>;
  showFallback: boolean;
  searchQuery: string;
};

// Shared state + cross-module callbacks for the graph editor. Assembled in index.ts
// and threaded into the outliner / multi-pane view modules. The callback fields are
// populated during setup and resolved at call time (late binding).
export interface GraphEditorContext {
  // ── Immutable config ──
  gId: string;
  limit: number;
  rootNodeId: string | null;
  outer: HTMLElement;
  // ── Shared mutable state ──
  state: ExplorerState;
  childrenCache: Map<string | null, ExplorerNode[]>;
  propStore: Map<string, Record<string, string>>;
  allPropKeys: Set<string>;
  // key → { colorId, code } for property key colors
  allPropColors: Map<string, { colorId: string; code: string }>;
  // m_color palette: id → code
  colorPalette: Map<string, string>;
  tempNodeCounter: number;
  // ── Property change broadcast ──
  // Outliner views register a callback here; syncPropChange passes the changed nodeId
  // so each pane can do targeted row removal instead of a full re-render.
  propChangeHooks: Array<(nodeId: string) => void>;
  // Property-key order broadcast. Outliner views register a callback here; when one pane
  // reorders (or deletes) property keys, it passes the new order so every pane updates its
  // local keyOrder and re-renders, keeping the grouping order in sync without a reload.
  keyOrderHooks: Array<(order: string[]) => void>;
  // ── Cross-pane (multi-pane outliner) DnD shared state ──
  // Set by the source pane on dragstart, read by the target pane on drop; null when idle.
  paneDrag: PaneDragState | null;
  // ── Persistence ──
  // Called after childrenCache is updated so callers can persist it to localStorage
  saveChildrenCache?: () => void;
}
