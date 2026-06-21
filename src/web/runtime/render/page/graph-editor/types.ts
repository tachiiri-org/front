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

export type ExplorerColumn = {
  parentId: string | null; // null for column 0 (all-nodes view)
  nodes: ExplorerNode[];
  loading: boolean;
  selectedId: string | null;
  hasMore?: boolean;   // col 0 pagination
  nextOffset?: number; // next page offset for col 0
};

export type ExplorerState = {
  graphId: string;
  lang: 'en' | 'ja';
  limit: number;
  columns: ExplorerColumn[];
  bookmarks: Set<string>;
  showFallback: boolean;
  linkSourceId: string | null;   // last focused node — source for link operations
  linkedNodeIds: Set<string>;    // nodes currently linked to linkSourceId
  searchQuery: string;
};

// Deferred delete + undo: deletion is held for UNDO_MS before hitting the backend
// so it can be undone.
export type PendingDelete = {
  node: ExplorerNode;
  colIndex: number;
  insertIndex: number;    // original position in col.nodes
  wasSelected: boolean;   // node was the selected id when deleted
  parentId: string | null;
  snapshotCache: ExplorerNode[] | undefined;
  timer: ReturnType<typeof setTimeout>;
};

// Shared state + cross-module callbacks for the graph editor. Assembled in index.ts
// and threaded into the column / node-row / keyboard / delete modules. The callback
// fields are populated during setup and resolved at call time (late binding), which
// is what lets the mutually-recursive render functions live in separate files.
export interface GraphEditorContext {
  // ── Immutable config ──
  gId: string;
  limit: number;
  rootNodeId: string | null;
  outer: HTMLElement;
  columnsEl: HTMLElement;
  // ── Shared mutable state ──
  state: ExplorerState;
  childrenCache: Map<string | null, ExplorerNode[]>;
  propStore: Map<string, Record<string, string>>;
  allPropKeys: Set<string>;
  // key → { colorId, code } for property key colors
  allPropColors: Map<string, { colorId: string; code: string }>;
  // m_color palette: id → code
  colorPalette: Map<string, string>;
  columnVersion: number;
  tempNodeCounter: number;
  // While set, this id is filtered out of every column so a refetch cannot resurrect it.
  pendingDeleteId: string | null;
  // ── Column module ──
  loadColumn: (parentId: string | null, colIndex: number) => Promise<void>;
  rebuildAll: () => void;
  appendColumn: (colIndex: number) => void;
  buildColumnEl: (colIndex: number) => HTMLElement;
  onNodeFocus: (colIndex: number, nodeId: string) => void;
  refreshRowStyles: (colIndex: number) => void;
  // ── Node-row / link module ──
  buildNodeRow: (node: ExplorerNode, colIndex: number) => HTMLElement;
  getColumnTextareas: (colIndex: number) => HTMLTextAreaElement[];
  setLinkSource: (nodeId: string) => Promise<void>;
  refreshAllMarkers: () => void;
  refreshAllNodeText: () => void;
  // ── Breadcrumb (index) ──
  refreshBreadcrumb: () => void;
  // ── Property change broadcast ──
  // Outliner views register a callback here; syncPropChange passes the changed nodeId
  // so each pane can do targeted row removal instead of a full re-render.
  propChangeHooks: Array<(nodeId: string) => void>;
  // ── Column DnD shared state ──
  colDndNodeId: string | null;
  colDndColIndex: number;
  // ── Cross-pane (multi-pane outliner) DnD shared state ──
  // Set by the source pane on dragstart, read by the target pane on drop; null when idle.
  paneDrag: PaneDragState | null;
  // ── Persistence ──
  // Called after childrenCache is updated so callers can persist it to localStorage
  saveChildrenCache?: () => void;
  // ── Delete module ──
  deleteNode: (node: ExplorerNode, colIndex: number, focusNodeId?: string) => void;
}
