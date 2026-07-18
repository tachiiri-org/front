export type ExplorerNode = { id: string; en?: string; ja?: string; color?: string; properties?: Record<string, string> };

// 関係 line: テキスト本文(body, 言語ごと)と順序付き参加者(participants, 先頭=主語)を持つ n 項エッジ。
// 構造ツリーの枝(テキスト無しの line)とは別物で、各参加ノードの「関係」一覧として現れる。
// level = リレーションパネルでのアウトライン階層（インデント深さ, 0=トップ, ノード別）。h2/h3 の意味付けは
// せず単なる親子。省略時は 0。
export type ExplorerRelation = { lineId: string; body: Record<string, string>; participants: ExplorerNode[]; level?: number };

// コンテキスト(ノードのページ)を構成する順序付きブロック。見出しブロックは規範=リレーション参照で、
// h2/h3 の level と、そのノードがそのリレーションに参加するか(direct)を持つ。テキストブロックは
// 非規範のフリーテキスト(言語別, ノードリンクを含まない)。バックエンド /node/:id/context に対応。
export type ContextBlock =
  | { blockId: string; kind: 'heading'; level: number; direct: boolean; line: ExplorerRelation }
  | { blockId: string; kind: 'text'; body: Record<string, string> };

// Cross-pane drag state for the multi-pane (パネル) view. Each pane is an independent
// outliner instance with its own closure scope, so the source pane records the dragged
// node(s) here on dragstart and the target pane reads them on drop — letting a node be
// dragged from one pane and dropped into another.
export type NodePanelDragState = {
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

// Path breadcrumb entry (structurally identical to outliner-view's PathEntry).
export type PanelPathEntry = { id: string | null; label: string };

// The interface a multi-pane column exposes. Both the outliner (node) view and the relation
// (line) view satisfy this, so multi-pane can host either kind of column uniformly. Methods that
// only make sense for the node view (key-move, ancestors, path) are present so a line view can
// implement them as inert no-ops.
export interface PanelView {
  el: HTMLElement;
  // The panel's 28px operation header row (used by panels-view to insert a reorder grip). Node and
  // relation views both expose it so the multi-pane container can make either kind reorderable.
  head?: HTMLElement;
  load: () => Promise<void>;
  refresh: () => void;
  search: (query: string) => Promise<void>;
  setParent: (nodeId: string | null, excludeIds?: Set<string>, path?: PanelPathEntry[]) => Promise<void>;
  getAncestorIds: (nodeId: string) => Set<string>;
  getNodePath: (nodeId: string) => PanelPathEntry[];
  getSelectedId: () => string | null;
  getSourceNodeId: () => string | null;
  setLang: (l: 'en' | 'ja') => void;
  setSourceRoot: () => Promise<void>;
  beginKeyMove: (nodeId: string) => boolean;
  acceptKeyMove: () => Promise<void>;
  getEffectiveParentId: () => string | null;
  getNodeParentId: (nodeId: string) => string | null | undefined;
  unregister: () => void;
}

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
  // m_color palette: id → code
  colorPalette: Map<string, string>;
  tempNodeCounter: number;
  // ── temp-id → real-id reconciliation (shared across panes) ──
  // A node created optimistically gets a `temp-N` id (N from tempNodeCounter, globally unique) until
  // its create round-trips. Other panes — the relation dock especially — must NEVER write a temp id
  // to the backend (it would persist a `⟦temp-N⟧` chip / temp participant that can never resolve), so
  // they await the real id here. The node pane registers a temp on optimistic insert and resolves it
  // on swap. `awaitRealId` passes real ids straight through and never hangs on an unknown id.
  tempRealId: Map<string, string>;
  registerTempId: (tempId: string) => void;
  resolveTempId: (tempId: string, realId: string) => void;
  awaitRealId: (id: string) => Promise<string>;
  // ── Cross-pane (multi-pane outliner) DnD shared state ──
  // Set by the source pane on dragstart, read by the target pane on drop; null when idle.
  nodePanelDrag: NodePanelDragState | null;

  // ── 関係(line)とノードの相互選択 ──
  // The relation currently selected in the line panel. Node nodePanels read `participants` to fill
  // (塗り=参加) / empty (空=非参加) each node's square; right-click a square toggles membership.
  activeRelation: { lineId: string; participants: Set<string> } | null;
  // Each node pane registers a "redraw all my square markers" callback here so the line panel can
  // notify them when the active relation (or its participants) change.
  relationRerender: Set<() => void>;
  // Set/clear the active relation and notify every registered node pane.
  setActiveRelation: (r: { lineId: string; participants: Set<string> } | null) => void;
  // Right-click handler: add/remove the node as a participant of the active relation, then notify.
  toggleParticipant: (nodeId: string) => Promise<void>;
  // Line panel(s) register a refresh here; called after a square right-click changes membership so
  // the relation rows re-fetch fresh participants (keeps the active set authoritative on re-focus).
  refreshRelations: Set<() => void>;
  // Node pane(s) register here to apply a rename made elsewhere (e.g. from the relation panel's
  // breadcrumb) to their local model so the label updates without a full refetch.
  nodeRenamed: Set<(id: string, lang: 'en' | 'ja', label: string) => void>;
  // Set by the line panel: convert a node into a relation (its label becomes the relation body,
  // linked to the panel's current node) and DELETE the node. Used by node→relation drag-drop and
  // the Shift+Alt+→ shortcut. The caller removes the node from its own pane afterwards.
  moveNodeToRelation?: (node: ExplorerNode, targetNodeId: string | null) => Promise<void>;
  // Set by multi-pane: open an additional relation panel to the right of the line dock, showing the
  // given node's relations (Miller-column style). Triggered by right-clicking a node-link chip.
  openRelationPanel?: (nodeId: string, label?: string) => void;
  // Set by multi-pane: make `nodeId` the globally-selected node (last-clicked). Selecting drives the
  // relation panel (its relations) and any node panel sourced from 「選択中」(its children). Called
  // by left-clicking a relation node-link chip and on node-row focus.
  selectNode?: (nodeId: string, label?: string) => void;
  // Registered by the context panel: scroll/focus the heading block that references `lineId`. The
  // relation panel calls this when a relation (=見出し) is activated, so selecting a heading in the
  // relation navigator jumps the right-hand context document to that heading. No-op if the line has
  // no heading on the current node's page.
  focusContextHeading?: (lineId: string) => void;
}
