import type { ExplorerNode, GraphEditorContext } from './types';
import { BG, BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG, ORPHAN_ID, ORPHAN_LABEL, primaryLabel, fallbackLabel } from './constants';
import {
  fetchChildren, fetchBookmarks, fetchBookmarkedNodes, fetchAllNodes,
  apiCreateNode as _apiCreateNode, apiUpdateNode, apiDeleteNode, apiMoveNode as _apiMoveNode, apiMoveBookmark,
  apiToggleLink as _apiToggleLink, apiUnlinkNode, fetchColors,
  fetchPlacementCount,
} from './api';

// '__orphan__' is a synthetic grouping, NOT a real node. Orphan nodes are rendered under it (so
// parentId === ORPHAN_ID), but sending it to the backend as a parent / link target would write a
// phantom edge to a non-existent node. Wrap the parent-bearing APIs to neutralise it: reorder
// AMONG orphans (parent = ORPHAN_ID) has no persistence target → no-op; reparenting an orphan onto
// a REAL node still goes through; creating a "sibling" of an orphan makes another parentless node.
const apiMoveNode = (graphId: string, nodeId: string, parentId: string, direction: 'up' | 'down', afterSwapSiblingIds: string[], keepalive = false): Promise<void> =>
  parentId === ORPHAN_ID ? Promise.resolve() : _apiMoveNode(graphId, nodeId, parentId, direction, afterSwapSiblingIds, keepalive);
const apiToggleLink = (graphId: string, sourceId: string, targetId: string): Promise<boolean> =>
  targetId === ORPHAN_ID ? Promise.resolve(false) : _apiToggleLink(graphId, sourceId, targetId);
const apiCreateNode = (graphId: string, parentId: string | null, lang: 'en' | 'ja', label: string, insertAfterId?: string): Promise<ExplorerNode | null> =>
  _apiCreateNode(graphId, parentId === ORPHAN_ID ? null : parentId, lang, label, insertAfterId);

// ── Tree model (single-parent outliner) ────────────────────────────────
// Each node appears at MOST ONCE in a pane (single placement: a node is shown under one
// parent only — see ensureChildren's dedup). So a row is keyed by the node id directly.
// `key` equals node.id (kept as a field so row / selection / index sites read uniformly);
// `parentKey` is the parent row's node id (null at the pane top); `parentId` is the
// underlying parent NODE id for the link/API layer (may be non-null even at the top).
type ONode = {
  node: ExplorerNode;
  /** Row key — equals node.id (single placement, so unique within the pane). */
  key: string;
  /** Parent row's key (= parent node id), or null for a pane top-level row. */
  parentKey: string | null;
  /** Underlying parent NODE id (kept for the link API / drag, which speak node ids). */
  parentId: string | null;
  depth: number;
  expanded: boolean;
  childrenLoaded: boolean;
  children: ONode[];
};

// Row keys are just the node id now (single placement). Kept as tiny helpers so the call
// sites that build keys stay readable; both ignore their former panel/path arguments.
const rootKey = (_panel: string | null, nodeId: string): string => nodeId;
const childKey = (_parentKey: string, nodeId: string): string => nodeId;

/** One breadcrumb hop: the node id and its display label, root-first. */
export type PathEntry = { id: string | null; label: string };

export type OutlinerPaneOpts = {
  /** Stable pane id (survives reload) — used to persist this pane's expansion state per-pane. */
  paneId?: string;
  /** If set, this pane shows children of this node (null = empty until setParent called) */
  paneParentId?: string | null;
  /** Breadcrumb path (root-first) to paneParentId, for panel-sourced panes */
  panePath?: PathEntry[];
  /** Per-pane display/edit language (overrides the global default for this pane) */
  lang?: 'en' | 'ja';
  /** Called when user focuses a node row (for inter-pane wiring) */
  onNodeSelect?: (nodeId: string | null) => void;
  /** Called after render with the content's natural width (px); used by multi-pane for auto-sizing */
  onContentWidthChange?: (width: number) => void;
  /** Ctrl/Cmd+→/← on a focused node: move it to the adjacent pane (reparent under that
   *  pane's parent). Returns true if a move was initiated (caller then suppresses the
   *  default caret-by-word behaviour). */
  onMoveNodeToPane?: (nodeId: string, direction: 'left' | 'right') => boolean;
  /** Ctrl/Cmd+Shift+→/← while a node in this pane is focused: move THIS pane (column) one
   *  slot left/right. Returns true if the pane moved (caller then suppresses the default
   *  caret-by-word behaviour). */
  onReorderPane?: (direction: 'left' | 'right') => boolean;
};

function showToast(msg: string) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = [
    'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
    'background:rgba(30,30,40,0.95)', 'color:#fff',
    'border:1px solid rgba(255,255,255,0.15)',
    'padding:6px 14px', 'border-radius:6px', 'font-size:12px',
    'z-index:9999', 'white-space:nowrap', 'pointer-events:none',
    'opacity:1', 'transition:opacity 0.4s ease',
  ].join(';');
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 1400);
  setTimeout(() => el.remove(), 1800);
}

export function createOutlinerView(ctx: GraphEditorContext, paneOpts?: OutlinerPaneOpts): {
  el: HTMLElement;
  load: () => Promise<void>;
  refresh: () => void;
  search: (query: string) => Promise<void>;
  setParent: (nodeId: string | null, excludeIds?: Set<string>, path?: PathEntry[]) => Promise<void>;
  getAncestorIds: (nodeId: string) => Set<string>;
  getNodePath: (nodeId: string) => PathEntry[];
  getSelectedId: () => string | null;
  getPaneParentId: () => string | null;
  setLang: (l: 'en' | 'ja') => void;
  setSourceRoot: () => Promise<void>;
  beginKeyMove: (nodeId: string) => boolean;
  acceptKeyMove: () => Promise<void>;
  getEffectiveParentId: () => string | null;
  getNodeParentId: (nodeId: string) => string | null | undefined;
  unregister: () => void;
} {
  // Outer wrapper (returned as el)
  const el = document.createElement('div');
  el.style.cssText = `flex:1;display:flex;flex-direction:column;overflow:hidden;`;

  // Breadcrumb bar (path). The separate parent-grouping panel header (見出し＋区切り線) is removed
  // elsewhere (showHeaders=false); only this path bar shows above the tree.
  const bcEl = document.createElement('div');
  bcEl.style.cssText = `display:flex;flex-shrink:0;align-items:center;gap:2px;flex-wrap:wrap;padding:4px 8px 4px 10px;border-bottom:1px solid ${BORDER};font-size:12px;`;
  el.appendChild(bcEl);

  // Draft row — shown only when list is empty; structurally matches a node row at depth 0
  const draftEl = document.createElement('div');
  draftEl.style.cssText = `display:none;align-items:center;padding:0;border:2px solid transparent;border-radius:3px;`;
  const draftSpacer = document.createElement('span');
  draftSpacer.style.cssText = `flex-shrink:0;width:6px;`;
  const draftBtnWrap = document.createElement('span');
  draftBtnWrap.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;`;
  const draftMarker = document.createElement('span');
  draftMarker.style.cssText = `width:7px;height:7px;border-radius:1px;box-sizing:border-box;pointer-events:none;background:transparent;border:1.5px solid ${TEXT_DIM};`;
  draftBtnWrap.appendChild(draftMarker);
  const draftTa = document.createElement('textarea');
  draftTa.rows = 1;
  draftTa.style.cssText = `flex:1;background:transparent;border:none;outline:none;resize:none;font-size:14px;font-family:inherit;line-height:1.5;padding:0 4px 0 0;overflow:hidden;min-height:20px;color:${TEXT_DIM};`;
  const draftResize = () => { draftTa.style.height = 'auto'; draftTa.style.height = draftTa.scrollHeight + 'px'; };
  draftTa.addEventListener('focus', () => { draftTa.style.color = TEXT_HIGH; });
  draftTa.addEventListener('blur', () => { if (!draftTa.value.trim()) draftTa.style.color = TEXT_DIM; });
  draftTa.addEventListener('input', draftResize);
  draftTa.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { draftTa.value = ''; draftTa.blur(); draftTa.style.color = TEXT_DIM; return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const label = draftTa.value.trim();
      draftTa.value = ''; draftResize(); draftTa.style.color = TEXT_DIM;
      const parentId = paneParentSet ? paneParentId : (ctx.rootNodeId ?? null);
      if (!parentId) return;
      // Optimistic: insert temp node immediately (same pattern as doAddSibling).
      const tempId = `temp-${++ctx.tempNodeCounter}`;
      const tempNode: ExplorerNode = { id: tempId, [paneLang]: label };
      const tempKey = rootKey(null, tempId);
      const o = make(tempNode, parentId, baseDepth, tempKey, null);
      o.childrenLoaded = true;
      rootNodeList.unshift(tempNode);
      roots.unshift(o);
      let resolveTemp!: () => void;
      tempReady.set(tempId, new Promise<void>(res => { resolveTemp = res; }));
      render(); // hides draft row, shows temp node at top
      focusRow(o);
      const nn = await apiCreateNode(ctx.gId, parentId, paneLang, label);
      if (!nn) {
        resolveTemp(); tempReady.delete(tempId);
        roots.splice(roots.indexOf(o), 1); unindexOcc(o);
        const rli = rootNodeList.indexOf(tempNode); if (rli >= 0) rootNodeList.splice(rli, 1);
        rowMap.get(tempKey)?.remove(); rowMap.delete(tempKey);
        render(); // restore draft row
        return;
      }
      const typedText = rowMap.get(o.key)?.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '';
      // temp id → real id: swap the row's id + key + index.
      swapNodeId(o, tempId, nn.id, rootKey(null, nn.id));
      Object.assign(tempNode, nn); // copy labels/color (id already set to real by swapNodeId)
      resolveTemp(); tempReady.delete(tempId);
      if (typedText.trim() && typedText.trim() !== label) void apiUpdateNode(ctx.gId, nn.id, paneLang, typedText.trim());
      // Move to front in backend (was appended to chain end)
      void apiMoveNode(ctx.gId, nn.id, parentId, 'up', rootNodeList.map(r => r.id));
    }
  });
  draftEl.append(draftSpacer, draftBtnWrap, draftTa);
  el.appendChild(draftEl);

  // Scrollable list
  const listEl = document.createElement('div');
  listEl.dataset.outlinerList = '1';
  listEl.style.cssText = `flex:1;overflow-y:auto;overflow-x:hidden;padding:4px 0;`;
  el.appendChild(listEl);

  let roots: ONode[] = [];
  // Canonical top-level node list (one entry per node id), the source from which `roots` is
  // (re)built. A node that links to several panel targets becomes one root occurrence per
  // panel (multi-membership). Kept separate so we can rebuild occurrences after async
  // link-target loading without refetching.
  let rootNodeList: ExplorerNode[] = [];
  // Underlying parent NODE id for the current top-level rows (pane parent / zoom node / null).
  let rootParentNodeId: string | null = null;
  let baseDepth = 0; // depth of current root level (for relative indent display)
  // Row index: node id → ONode. Single placement means at most one ONode per id.
  const byKey = new Map<string, ONode>();
  // node id → row element.
  const rowMap = new Map<string, HTMLElement>();
  // The ONode for a node id, or undefined (one per id under single placement).
  const anyOccOf = (nodeId: string): ONode | undefined => byKey.get(nodeId);
  // The live ONode(s) for a node id — 0 or 1 under single placement. Kept as an array so the
  // node-level call sites (rename / delete) read uniformly.
  const occsOf = (nodeId: string): ONode[] => { const o = byKey.get(nodeId); return o ? [o] : []; };
  // Index helpers.
  const indexOcc = (o: ONode) => { byKey.set(o.key, o); };
  const unindexOcc = (o: ONode) => { byKey.delete(o.key); };
  // Unindex a row AND its whole displayed subtree (used when a subtree is removed from the pane).
  const unindexSubtree = (o: ONode) => {
    for (const c of o.children) unindexSubtree(c);
    rowMap.delete(o.key);
    unindexOcc(o);
  };
  const clearIndex = () => { byKey.clear(); };

  // Swap a row's underlying node id (temp → real), keeping byKey / rowMap consistent. The key
  // equals the node id, so newKey is the new id. Recurses into the subtree (child keys are just
  // their own node ids, unchanged).
  const swapNodeId = (o: ONode, _oldId: string, newId: string, newKey: string) => {
    const row = rowMap.get(o.key);
    byKey.delete(o.key);
    rowMap.delete(o.key);
    o.node.id = newId;
    o.key = newKey;
    indexOcc(o);
    if (row) { rowMap.set(newKey, row); row.dataset.nodeId = newId; }
    for (const c of o.children) swapNodeId(c, c.node.id, c.node.id, c.node.id);
  };
  // No-cache / always-online model: every read hits the DO (the single source of truth); the
  // frontend keeps no persistent cache and does not restore expansion across reloads. Reload shows
  // the root's children collapsed (one /children call).

  // Per-pane language (display + edit). Falls back to the global default when unset.
  let paneLang: 'en' | 'ja' = paneOpts?.lang ?? ctx.state.lang;

  // Pane state
  let paneParentSet = paneOpts?.paneParentId !== undefined;
  let paneParentId: string | null = paneOpts?.paneParentId ?? null;
  let paneSelectedId: string | null = null;
  // Breadcrumb path (root-first, inclusive of paneParentId) for panel-sourced panes
  let externalPath: PathEntry[] = paneOpts?.panePath ?? [];

  const labelOf = (node: ExplorerNode): string =>
    primaryLabel(node, paneLang) ?? fallbackLabel(node, paneLang) ?? node.id.slice(0, 8);

  // Path (root-first, inclusive) to the node whose children form this pane's top-level rows.
  const selfPathPrefix = (): PathEntry[] => {
    const base: PathEntry[] = paneParentSet
      ? [...externalPath]
      : (ctx.rootNodeId ? [{ id: ctx.rootNodeId, label: 'ルート' }] : []);
    for (const z of zoomStack) base.push({ id: z.node.id, label: labelOf(z.node) });
    return base;
  };

  // Full breadcrumb path (root-first, inclusive) to a node currently visible in this pane.
  // External callers pass a node id; we resolve any one of its occurrences and walk up its
  // parentKey chain (occurrence-accurate, so a multi-membership node yields the path of the
  // occurrence we happened to pick — acceptable, breadcrumb is display-only here).
  const getNodePath = (nodeId: string): PathEntry[] => {
    const chain: PathEntry[] = [];
    const seen = new Set<string>();
    let cur = anyOccOf(nodeId);
    while (cur) {
      if (seen.has(cur.key)) break; // cycle guard — never spin
      seen.add(cur.key);
      chain.unshift({ id: cur.node.id, label: labelOf(cur.node) });
      if (cur.parentKey == null) break;
      cur = byKey.get(cur.parentKey);
    }
    return [...selfPathPrefix(), ...chain];
  };

  const setPaneSelected = (nodeId: string | null) => {
    paneSelectedId = nodeId;
    paneOpts?.onNodeSelect?.(nodeId);
  };

  // Zoom stack: ONodes we've zoomed into (innermost last)
  const zoomStack: ONode[] = [];

  // Multi-select state: anchor (fixed end) and cur (moving end). Keyed by OCCURRENCE key so
  // selecting one occurrence of a multi-membership node doesn't also select its twins.
  let selAnchorKey: string | null = null;
  let selCurKey: string | null = null;

  // Create an ONode for a node occurrence. `key` is the occurrence key (rootKey/childKey);
  // `parentKey` is the parent occurrence's key (null at the pane top). `parentId` stays the
  // underlying parent NODE id for the API/drag layers.
  const make = (
    node: ExplorerNode, parentId: string | null, depth: number,
    key: string, parentKey: string | null,
  ): ONode => {
    const o: ONode = { node, key, parentKey, parentId, depth, expanded: false, childrenLoaded: false, children: [] };
    indexOcc(o);
    return o;
  };
  // Walk parentKey chain to collect ancestor NODE ids of an occurrence (used to exclude
  // ancestors from a node's loaded children — undirected edges surface ancestors as
  // neighbours). Cycle-safe via the unique occurrence keys.
  const ancestorIds = (onode: ONode): Set<string> => {
    const ids = new Set<string>();
    let cur: ONode | undefined = onode.parentKey ? byKey.get(onode.parentKey) : undefined;
    const seen = new Set<string>();
    while (cur) {
      if (seen.has(cur.key)) break;
      seen.add(cur.key);
      ids.add(cur.node.id);
      cur = cur.parentKey ? byKey.get(cur.parentKey) : undefined;
    }
    return ids;
  };

  const flatVisible = (): ONode[] => {
    const out: ONode[] = [];
    const walk = (list: ONode[]) => {
      for (const n of list) { out.push(n); if (n.expanded) walk(n.children); }
    };
    walk(roots);
    return out;
  };

  // (Re)build the `roots` ONode array from `rootNodeList` — one row per node, in list order —
  // preserving the expand/loaded state of any row whose key (= node id) still exists.
  // Re-indexes byKey for the top level only (descendants are recreated lazily by ensureChildren).
  const buildRoots = () => {
    // Remember which roots were expanded so a rebuild keeps them open.
    const prevExpanded = new Set<string>();
    for (const r of roots) if (r.expanded) prevExpanded.add(r.key);
    // Detach old root rows (and their subtrees) from the index.
    const dropSubtree = (o: ONode) => { for (const c of o.children) dropSubtree(c); unindexOcc(o); };
    for (const r of roots) dropSubtree(r);

    const next: ONode[] = [];
    for (const node of rootNodeList) {
      const o = make(node, rootParentNodeId, baseDepth, node.id, null);
      if (prevExpanded.has(node.id)) o.expanded = true;
      next.push(o);
    }
    roots = next;
  };

  // Set the pane's top-level node list, rebuild root rows, and render. `parentNodeId` is the
  // underlying parent node id for the top level; `excl` filters out nodes that must not appear
  // as roots.
  const applyRoots = (nodes: ExplorerNode[], parentNodeId: string | null, excl?: Set<string>) => {
    rootParentNodeId = parentNodeId;
    baseDepth = 0;
    rootNodeList = excl ? nodes.filter(n => !excl.has(n.id)) : nodes.slice();
    buildRoots();
    render();
  };

  const render = () => { renderNested(); };

  const renderNested = () => {
    rowMap.clear();
    listEl.innerHTML = '';
    // Render a top-level node and, when expanded, its visible subtree. Roots are rendered in
    // rootNodeList order (no panel grouping) — a stable, single-parent outline.
    const appendSubtree = (o: ONode) => {
      listEl.appendChild(buildRow(o));
      if (o.expanded) for (const c of o.children) appendSubtree(c);
    };
    for (const top of roots) appendSubtree(top);
    // Show draft row only when list is empty AND a valid parent is known
    const draftParentId = paneParentSet ? paneParentId : (ctx.rootNodeId ?? null);
    draftEl.style.display = (roots.length === 0 && draftParentId !== null) ? 'flex' : 'none';
    updateSelectionHighlight();
    if (paneOpts?.onContentWidthChange) scheduleWidthUpdate();
  };

  // Canvas-based text width measurement — called after render to auto-size the pane width
  const scheduleWidthUpdate = () => {
    requestAnimationFrame(() => {
      // Minimum column width = 20vw (≥280px). Keep this as the floor in every branch so even
      // an empty/filtered pane stays wide enough for the header icons.
      const minW = Math.max(280, Math.round(window.innerWidth * 0.20));
      const maxCap = Math.round(window.innerWidth * 0.40);
      const rows = listEl.querySelectorAll<HTMLElement>('[data-node-id]');
      const firstTa = rows[0]?.querySelector<HTMLTextAreaElement>('textarea');
      const font = firstTa ? getComputedStyle(firstTa).font : '14px sans-serif';
      const canvas = document.createElement('canvas');
      const c = canvas.getContext('2d')!;
      c.font = font;
      let maxW = 0;
      rows.forEach(row => {
        const spacer = row.querySelector<HTMLElement>('span');
        const ta = row.querySelector<HTMLTextAreaElement>('textarea');
        if (!ta) return;
        const spacerW = spacer?.offsetWidth ?? 0;
        const textW = Math.ceil(c.measureText(ta.value).width);
        maxW = Math.max(maxW, spacerW + 18 + textW + 48);
      });
      // Group headers (breadcrumb path + controls) are part of the content too: size to fit the
      // crumbs' intrinsic width (scrollWidth, since the crumb box clips) plus the fixed controls.
      listEl.querySelectorAll<HTMLElement>('[data-panel-header]').forEach(h => {
        const crumbs = h.querySelector<HTMLElement>('[data-crumbs]');
        let w = 12; // horizontal padding
        for (const child of Array.from(h.children) as HTMLElement[]) {
          w += child === crumbs ? child.scrollWidth : child.offsetWidth;
        }
        maxW = Math.max(maxW, w);
      });
      if (maxW === 0) { paneOpts!.onContentWidthChange!(minW); return; }
      // Start wide by default (matches the initial PANE_WIDTH baseline); shrink only when
      // every row's text is shorter than this, grow up to maxCap when text is long.
      paneOpts!.onContentWidthChange!(Math.min(Math.max(minW, maxW), maxCap));
      // Column width changed → textarea wrapping changed → re-measure heights
      requestAnimationFrame(() => {
        listEl.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(ta => {
          ta.style.height = 'auto';
          ta.style.height = ta.scrollHeight + 'px';
        });
      });
    });
  };

  const focusRow = (onode: ONode) => {
    rowMap.get(onode.key)?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  };

  // Selection is occurrence-keyed: anchor/cur are occurrence keys, so only the specific
  // dragged/clicked occurrence is selected even for a multi-membership node.
  const getSelectedONodes = (): ONode[] => {
    if (!selAnchorKey) return [];
    const vis = flatVisible();
    const ai = vis.findIndex(n => n.key === selAnchorKey);
    if (ai === -1) return [];
    if (!selCurKey || selCurKey === selAnchorKey) return [vis[ai]].filter(Boolean);
    const ci = vis.findIndex(n => n.key === selCurKey);
    if (ci === -1) return [vis[ai]].filter(Boolean);
    return vis.slice(Math.min(ai, ci), Math.max(ai, ci) + 1);
  };

  const isMultiSelect = () => getSelectedONodes().length > 1;

  const updateSelectionHighlight = () => {
    const sel = getSelectedONodes();
    const keys = sel.length > 1 ? new Set(sel.map(n => n.key)) : new Set<string>();
    rowMap.forEach((row, key) => {
      row.style.backgroundColor = keys.has(key) ? 'rgba(99,102,241,0.12)' : '';
    });
  };

  const clearSelection = () => { selAnchorKey = null; selCurKey = null; updateSelectionHighlight(); };

  const lastDescRow = (onode: ONode): HTMLElement | undefined => {
    if (onode.expanded && onode.children.length > 0)
      return lastDescRow(onode.children[onode.children.length - 1]);
    return rowMap.get(onode.key);
  };

  const visibleRowGroup = (onode: ONode): HTMLElement[] => {
    const rows: HTMLElement[] = [];
    const walk = (o: ONode) => {
      const r = rowMap.get(o.key); if (r) rows.push(r);
      if (o.expanded) o.children.forEach(walk);
    };
    walk(onode);
    return rows;
  };

  // Wraps fetchChildren and strips the graph root node (appears as a neighbor via undirected edges)
  const fetchChildrenFiltered = async (nodeId: string) => {
    const nodes = await fetchChildren(ctx.gId, nodeId, ctx.limit);
    return ctx.rootNodeId ? nodes.filter(n => n.id !== ctx.rootNodeId) : nodes;
  };

  const ensureChildren = async (onode: ONode) => {
    if (onode.childrenLoaded) return;
    // Always fetch fresh from the DO (no cache). childrenLoaded still short-circuits a re-expand,
    // so expanding a node stays exactly one /children call.
    const fresh = await fetchChildrenFiltered(onode.node.id);
    // Single placement: show each node under ONE parent only. Exclude ancestors (surfaced as
    // neighbours by undirected edges) AND any node already placed elsewhere in this pane
    // (byKey.has) — so a node reachable via two parents (diamond) appears under whichever
    // parent was expanded first, never twice. This is what keeps row keys (= node ids) unique.
    const excl = ancestorIds(onode); excl.add(onode.node.id);
    const kids = fresh.filter(c => !excl.has(c.id) && !byKey.has(c.id));
    onode.children = kids
      .map(c => make(c, onode.node.id, onode.depth + 1, childKey(onode.key, c.id), onode.key));
    onode.childrenLoaded = true;
  };

  const updateExpandMarker = (onode: ONode) => {
    const row = rowMap.get(onode.key);
    if (!row) return;
    const m = row.querySelector<HTMLElement>('[data-expand-marker]');
    if (!m) return;
    // 四角はデフォルトは塗らない（輪郭のみ）。関係(line)が選択中ならその関係の参加ノードを塗り、
    // 関係が無いときは「選択中のノード」を塗る。
    const ar = ctx.activeRelation;
    const blue = ar ? ar.participants.has(onode.node.id) : (onode.node.id === paneSelectedId);
    if (blue) {
      m.style.border = 'none';
      m.style.background = SELECT_STRONG;
    } else {
      m.style.background = 'transparent';
      m.style.border = `1.5px solid ${TEXT_DIM}`;
    }
  };

  const expandInDom = (onode: ONode) => {
    onode.expanded = true;
    updateExpandMarker(onode);
    let anchor: HTMLElement | undefined = rowMap.get(onode.key);
    if (!anchor) return;
    let anchorEl: HTMLElement = anchor;
    const insertSubtree = (list: ONode[]) => {
      for (const child of list) {
        const row = buildRow(child);
        anchorEl.insertAdjacentElement('afterend', row);
        anchorEl = row;
        if (child.expanded) insertSubtree(child.children);
      }
    };
    insertSubtree(onode.children);
  };

  const collapseInDom = (onode: ONode) => {
    onode.expanded = false;
    updateExpandMarker(onode);
    const removeSubtree = (list: ONode[]) => {
      for (const child of list) {
        rowMap.get(child.key)?.remove(); rowMap.delete(child.key);
        if (child.expanded) removeSubtree(child.children);
      }
    };
    removeSubtree(onode.children);
  };

  const expandingSet = new Set<string>();
  const toggleExpand = async (onode: ONode, forceExpand?: boolean) => {
    const next = forceExpand !== undefined ? forceExpand : !onode.expanded;
    if (next === onode.expanded) { focusRow(onode); return; }
    if (next && expandingSet.has(onode.key)) return;
    if (next && !onode.childrenLoaded) {
      expandingSet.add(onode.key);
      await ensureChildren(onode);
      expandingSet.delete(onode.key);
    }
    if (next && onode.children.length === 0) { updateExpandMarker(onode); focusRow(onode); return; }
    if (next) expandInDom(onode); else collapseInDom(onode);
    // expand/collapse mutate the DOM directly (no full render), so re-measure the pane
    // width here — otherwise collapsing long rows leaves the column stuck at its wide size.
    if (paneOpts?.onContentWidthChange) scheduleWidthUpdate();
    focusRow(onode);
  };

  // ── Breadcrumb ───────────────────────────────────────────────────────
  const updateBreadcrumb = () => {
    bcEl.style.display = '';
    bcEl.innerHTML = '';

    const btnStyle = (active: boolean) =>
      `background:transparent;border:none;color:${active ? TEXT_HIGH : TEXT_MID};cursor:${active ? 'default' : 'pointer'};font-size:12px;padding:0 2px;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;`;

    const appendSep = () => {
      const sep = document.createElement('span');
      sep.textContent = ' › ';
      sep.style.color = TEXT_DIM;
      bcEl.appendChild(sep);
    };
    const appendLabel = (text: string, active: boolean) => {
      const span = document.createElement('span');
      span.textContent = text;
      span.title = text;
      span.style.cssText = `color:${active ? TEXT_HIGH : TEXT_MID};font-size:12px;padding:0 2px;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;`;
      bcEl.appendChild(span);
    };

    // Panel-sourced pane: prepend the (display-only) path inherited from the source pane.
    const usesExternal = paneParentSet && externalPath.length > 0;
    if (usesExternal) {
      externalPath.forEach((e, i) => {
        if (i > 0) appendSep();
        appendLabel(e.label, zoomStack.length === 0 && i === externalPath.length - 1);
      });
    } else if (zoomStack.length === 0) {
      // Root-sourced with no zoom: static "ルート" label (no fall-through return so the
      // copy-path button below is still appended).
      appendLabel('ルート', true);
    } else {
      // Root-sourced, zoomed in: clickable "ルート" home.
      const homeBtn = document.createElement('button');
      homeBtn.textContent = 'ルート';
      homeBtn.style.cssText = btnStyle(false);
      homeBtn.addEventListener('click', () => void doZoomTo(0));
      bcEl.appendChild(homeBtn);
    }

    zoomStack.forEach((on, i) => {
      appendSep();
      const btn = document.createElement('button');
      const lbl = labelOf(on.node);
      btn.textContent = lbl;
      btn.title = lbl;
      btn.style.cssText = btnStyle(i === zoomStack.length - 1);
      if (i < zoomStack.length - 1) btn.addEventListener('click', () => void doZoomTo(i + 1));
      bcEl.appendChild(btn);
    });

    // Copy-path button — copies the current breadcrumb path as a "/"-joined string.
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '❐';
    copyBtn.title = 'パスをコピー';
    copyBtn.style.cssText = `margin-left:auto;background:transparent;border:none;color:${TEXT_MID};cursor:pointer;font-size:12px;padding:0 4px;line-height:1;flex-shrink:0;`;
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pathStr = selfPathPrefix().map(p => p.label).join('/');
      if (!pathStr) return;
      void navigator.clipboard.writeText(pathStr).then(() => showToast('パスをコピーしました'));
    });
    bcEl.appendChild(copyBtn);
  };

  // ── Zoom ─────────────────────────────────────────────────────────────
  const doZoomIn = async (onode: ONode) => {
    if (!onode.childrenLoaded) await ensureChildren(onode);
    if (onode.children.length === 0) return; // leaf — nothing to zoom into
    zoomStack.push(onode);
    // Zoomed view shows the node's loaded children directly (a subtree, not link panels), so
    // roots are the existing child occurrences as-is. Keep rootParent/rootNodeList in sync.
    roots = onode.children;
    rootParentNodeId = onode.node.id;
    rootNodeList = onode.children.map(c => c.node);
    baseDepth = onode.depth + 1;
    render();
    updateBreadcrumb();
    if (roots.length > 0) focusRow(roots[0]);
  };

  const doZoomTo = async (level: number) => {
    zoomStack.splice(level);
    if (zoomStack.length === 0) {
      await load();
    } else {
      const top = zoomStack[zoomStack.length - 1];
      roots = top.children;
      rootParentNodeId = top.node.id;
      rootNodeList = top.children.map(c => c.node);
      baseDepth = top.depth + 1;
      render();
      updateBreadcrumb();
    }
  };

  const doZoomOut = async () => {
    if (zoomStack.length === 0) return;
    const prev = zoomStack[zoomStack.length - 1];
    await doZoomTo(zoomStack.length - 1);
    // Focus the node we just came from (now visible in parent view). After the rebuild its
    // occurrence key may differ, so fall back to any occurrence of the same node id.
    const back = byKey.get(prev.key) ?? anyOccOf(prev.node.id);
    if (back) focusRow(back);
  };

  // ── Row builder ──────────────────────────────────────────────────────
  // Active drag state for node reordering / reparenting
  let dragNodeId: string | null = null;
  let dragParentId: string | null | undefined = undefined;
  let dragKey: string | null = null;          // occurrence key of the (single) dragged row
  let dragMultiKeys: string[] | null = null; // occurrence keys; non-null when dragging a multi-selection
  // Unique identity for this pane instance; lets the drop target distinguish a drag
  // that started in this same pane from one that started in another pane.
  const paneToken = {};

  // Map from temp ID to promise that resolves once the real ID is assigned
  const tempReady = new Map<string, Promise<void>>();

  // Await a node's real ID if it still has a temp ID; resolves instantly for real nodes
  const awaitRealId = (onode: ONode): Promise<void> => {
    if (!onode.node.id.startsWith('temp-')) return Promise.resolve();
    return tempReady.get(onode.node.id) ?? Promise.resolve();
  };

  // Remove the given nodes from THIS pane's local tree + caches and re-render. Called on the
  // source pane after a cross-pane drop moves nodes out of it. Removes EVERY occurrence of
  // each node id (multi-membership: the node may appear in several panels of this pane).
  const detachNodes = (nodes: ExplorerNode[]) => {
    for (const node of nodes) {
      for (const o of occsOf(node.id)) {
        const sibs = getSiblings(o);
        const idx = sibs.indexOf(o);
        if (idx >= 0) sibs.splice(idx, 1);
        if (o.parentKey === null) { const ri = rootNodeList.indexOf(o.node); if (ri >= 0) rootNodeList.splice(ri, 1); }
        unindexOcc(o);
      }
    }
    render();
  };

  // Drop target guard shared by dragover + drop: true when `onode` is one of the
  // dragged nodes, or (same-pane) sits inside a dragged node's subtree.
  const dropBlockedBy = (onode: ONode, pd: NonNullable<typeof ctx.paneDrag>): boolean => {
    if (pd.nodeIds.includes(onode.node.id)) return true;
    for (const id of pd.nodeIds) {
      for (const o of occsOf(id)) if (isInSubtree(onode, o)) return true;
    }
    return false;
  };

  const buildRow = (onode: ONode): HTMLElement => {
    const row = document.createElement('div');
    row.dataset.nodeId = onode.node.id;
    row.dataset.occKey = onode.key;
    row.style.cssText = `display:flex;align-items:center;padding:0;border:2px solid transparent;border-radius:3px;`;
    rowMap.set(onode.key, row);

    // Synthetic "リンクなし" group header: a static (non-renamable/movable) row that EXPANDS inline
    // to the orphan (parentless) nodes. The orphan nodes themselves are rendered by the normal
    // buildRow path, so they get the full node treatment (edit / drag-drop / shift+alt reorder /
    // shortcuts). Layout mirrors a normal row ([spacer][triangle][marker][label]) so it aligns.
    if (onode.node.id === ORPHAN_ID) {
      const spc = document.createElement('span');
      spc.style.cssText = `flex-shrink:0;width:${(onode.depth - baseDepth) * 20 + 6}px;`;
      const bw = document.createElement('span');
      bw.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;cursor:pointer;`;
      const mk = document.createElement('span');
      mk.dataset.expandMarker = '1';
      mk.style.cssText = `width:7px;height:7px;border-radius:1px;box-sizing:border-box;background:transparent;border:1.5px solid ${TEXT_DIM};pointer-events:none;`;
      bw.appendChild(mk);
      const lbl = document.createElement('span');
      lbl.textContent = ORPHAN_LABEL;
      lbl.style.cssText = `flex:1;font-size:14px;line-height:1.5;color:${TEXT_MID};cursor:pointer;padding:0 4px 0 0;`;
      lbl.addEventListener('click', () => void toggleExpand(onode));
      bw.addEventListener('click', (e) => { e.stopPropagation(); void toggleExpand(onode); });
      row.append(spc, bw, lbl);
      requestAnimationFrame(() => updateExpandMarker(onode));
      return row;
    }

    const spacer = document.createElement('span');
    spacer.style.cssText = `flex-shrink:0;width:${(onode.depth - baseDepth) * 20 + 6}px;`;
    row.appendChild(spacer);

    // Left square: click → property menu
    const btnWrap = document.createElement('span');
    btnWrap.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;cursor:pointer;`;
    const marker = document.createElement('span');
    marker.dataset.expandMarker = '1';
    marker.style.cssText = `width:7px;height:7px;border-radius:1px;box-sizing:border-box;pointer-events:none;`;
    btnWrap.appendChild(marker);
    // 四角クリック = ズーム（Alt+→ と同じ）。旧来のノード紐付けメニューは出さない（リンクは「/」で可能）。
    btnWrap.addEventListener('click', (e) => { e.stopPropagation(); void doZoomIn(onode); });
    // 四角を右クリック = アクティブ関係への参加 link/unlink トグル（関係が未選択なら何もしない）。
    btnWrap.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      void ctx.toggleParticipant(onode.node.id);
    });
    row.appendChild(btnWrap);

    const label = primaryLabel(onode.node, paneLang) ?? fallbackLabel(onode.node, paneLang);
    const ta = document.createElement('textarea');
    ta.value = label;
    ta.style.cssText = `flex:1;background:transparent;border:none;outline:none;resize:none;font-size:14px;font-family:inherit;line-height:1.5;padding:0 4px 0 0;overflow:hidden;min-height:20px;color:${onode.node.color ?? TEXT_HIGH};`;
    ta.rows = 1;

    const resize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    requestAnimationFrame(resize);
    ta.addEventListener('input', () => {
      resize();
      if (paneOpts?.onContentWidthChange) scheduleWidthUpdate();
    });
    ta.addEventListener('focus', () => setPaneSelected(onode.node.id));

    // Multi-line paste → one node per line: the first line merges into this row at the caret,
    // each remaining line becomes a sibling node below (in order). Single-line paste is left
    // to the browser's default handling.
    ta.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length <= 1) return; // single line → default paste
      e.preventDefault();
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      ta.value = ta.value.slice(0, start) + lines[0] + ta.value.slice(end);
      const caret = start + lines[0].length;
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event('input')); // resize + width
      void (async () => {
        let anchor = onode;
        for (let k = 1; k < lines.length; k++) {
          const created = await doAddSibling(anchor, false, { text: lines[k] });
          if (!created) break;
          anchor = created;
        }
      })();
    });

    ta.addEventListener('blur', () => {
      const old = primaryLabel(onode.node, paneLang) ?? fallbackLabel(onode.node, paneLang);
      const newVal = ta.value;
      if (newVal !== old) {
        // Rename acts on the NODE: onode.node is shared by every occurrence, so the data is
        // consistent at once; mirror the new label into the other occurrences' textareas too
        // so multi-membership twins update visibly without a full re-render.
        if (paneLang === 'en') onode.node.en = newVal; else onode.node.ja = newVal;
        for (const twin of occsOf(onode.node.id)) {
          if (twin === onode) continue;
          const twinTa = rowMap.get(twin.key)?.querySelector<HTMLTextAreaElement>('textarea');
          if (twinTa && twinTa.value !== newVal) twinTa.value = newVal;
        }
        void apiUpdateNode(ctx.gId, onode.node.id, paneLang, newVal);
      }
    });

    ta.addEventListener('keydown', (e) => {
      const vis = flatVisible();
      const i = vis.indexOf(onode);

      // Ctrl/Cmd+↓ expand, Ctrl/Cmd+↑ collapse
      if (e.key === 'ArrowDown' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault(); void toggleExpand(onode, true); return;
      }
      if (e.key === 'ArrowUp' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault(); void toggleExpand(onode, false); return;
      }

      // Ctrl/Cmd+→/←        : move the focused NODE to the adjacent pane (reparent).
      // Ctrl/Cmd+Shift+→/←  : move THIS pane (column) one slot, swapping with its neighbour.
      // Each only consumes the key when something actually moved, so caret-by-word still
      // works at the boundary (no node to reparent / no neighbouring pane).
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const dir = e.key === 'ArrowRight' ? 'right' : 'left';
        const moved = e.shiftKey
          ? paneOpts?.onReorderPane?.(dir)
          : paneOpts?.onMoveNodeToPane?.(onode.node.id, dir);
        if (moved) { e.preventDefault(); return; }
      }

      // Alt+→: zoom in (focus subtree), Alt+←: zoom out
      if (e.key === 'ArrowRight' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault(); void doZoomIn(onode); return;
      }
      if (e.key === 'ArrowLeft' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault(); void doZoomOut(); return;
      }

      // Shift+↑/↓: extend / shrink multi-select range
      if (e.key === 'ArrowUp' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const tAs = [...listEl.querySelectorAll<HTMLTextAreaElement>('textarea')];
        const tIdx = tAs.indexOf(ta);
        if (tIdx <= 0) return;
        if (!selAnchorKey) selAnchorKey = onode.key;
        const prevKey = tAs[tIdx - 1].closest<HTMLElement>('[data-occ-key]')?.dataset.occKey;
        if (prevKey) { selCurKey = prevKey; updateSelectionHighlight(); }
        tAs[tIdx - 1].focus();
        return;
      }
      if (e.key === 'ArrowDown' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const tAs = [...listEl.querySelectorAll<HTMLTextAreaElement>('textarea')];
        const tIdx = tAs.indexOf(ta);
        if (tIdx >= tAs.length - 1) return;
        if (!selAnchorKey) selAnchorKey = onode.key;
        const nextKey = tAs[tIdx + 1].closest<HTMLElement>('[data-occ-key]')?.dataset.occKey;
        if (nextKey) { selCurKey = nextKey; updateSelectionHighlight(); }
        tAs[tIdx + 1].focus();
        return;
      }

      // Esc: clear multi-select (stop propagation to prevent focus-search)
      if (e.key === 'Escape' && isMultiSelect()) {
        e.preventDefault(); e.stopPropagation(); clearSelection(); return;
      }

      // Shift+Alt+↑↓ reorder / cross-hierarchy move (multi or single)
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && e.altKey) {
        e.preventDefault();
        if (isMultiSelect()) void doMoveMulti(e.key === 'ArrowUp' ? 'up' : 'down');
        else void doMove(onode, e.key === 'ArrowUp' ? 'up' : 'down');
        return;
      }

      // Shift+Alt+→ : ノードを関係パネルへ移動（関係に変換してこのノードは削除）。ドラッグでの
      // ノード→関係ドロップと同じ操作のキーボード版。
      if (e.key === 'ArrowRight' && e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const node = onode.node;
        const parent = onode.parentId; // 紐づけ先＝親（focus でドックは X 自身に切り替わっているため）
        void (async () => { await ctx.moveNodeToRelation?.(node, parent); detachNodes([node]); })();
        return;
      }

      // Tab: indent / dedent (multi or single)
      if (e.key === 'Tab') {
        e.preventDefault();
        if (isMultiSelect()) {
          const sel = getSelectedONodes(); clearSelection();
          void doTabMulti(sel, e.shiftKey);
        } else {
          if (e.shiftKey) void doDedent(onode);
          else void doIndent(onode, vis, i);
        }
        return;
      }

      // Ctrl+Shift+Backspace: delete (multi or single)
      if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        if (isMultiSelect()) void doDeleteMulti();
        else void doDelete(onode, i, vis);
        return;
      }

      // ↑/↓ — DOM-order navigation; clear multi-select
      if (e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        clearSelection();
        const tAs = [...listEl.querySelectorAll<HTMLTextAreaElement>('textarea')];
        const tIdx = tAs.indexOf(ta);
        if (tIdx > 0) tAs[tIdx - 1].focus();
        return;
      }
      if (e.key === 'ArrowDown' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        clearSelection();
        const tAs = [...listEl.querySelectorAll<HTMLTextAreaElement>('textarea')];
        const tIdx = tAs.indexOf(ta);
        if (tIdx < tAs.length - 1) tAs[tIdx + 1].focus();
        return;
      }
      // /: link existing node (only when textarea is empty)
      if (e.key === '/' && ta.value === '' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault(); doLinkSearch(onode); return;
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); clearSelection();
        const before = ta.selectionStart === 0 && ta.selectionEnd === 0 && ta.value.length > 0;
        void doAddSibling(onode, before);
      } else if (e.key === 'Backspace' && ta.value === '') {
        e.preventDefault(); clearSelection(); void doDelete(onode, i, vis);
      }
    });

    // 展開/折畳みはキーボードのみ（Ctrl/Cmd+↓/↑）。三角などの展開マーカーは表示しない。

    // Long press (350ms) on row body → enable drag
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let pressStartX = 0, pressStartY = 0;
    let dragReady = false;

    const cancelPress = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    };

    row.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('button') || t.tagName === 'TEXTAREA') return;
      pressStartX = e.clientX; pressStartY = e.clientY;
      if (e.pointerType === 'mouse') {
        // Mouse: browser distinguishes click vs drag natively via movement threshold
        dragReady = true;
        row.draggable = true;
      } else {
        // Touch: long press to avoid conflicting with scroll/tap
        dragReady = false;
        pressTimer = setTimeout(() => {
          dragReady = true;
          row.draggable = true;
          row.style.opacity = '0.6';
        }, 350);
      }
    });
    row.addEventListener('pointermove', (e) => {
      if (!pressTimer) return;
      if (Math.abs(e.clientX - pressStartX) > 5 || Math.abs(e.clientY - pressStartY) > 5) cancelPress();
    });
    row.addEventListener('pointerup', () => {
      cancelPress();
      // If click (no drag started), reset draggable so it doesn't interfere with next interaction
      if (!dragNodeId) { row.draggable = false; dragReady = false; }
    });
    row.addEventListener('pointercancel', () => { cancelPress(); row.draggable = false; dragReady = false; });

    row.addEventListener('dragstart', (e) => {
      if (!dragReady) { e.preventDefault(); return; }
      row.style.opacity = '0.6';
      dragNodeId = onode.node.id;
      dragKey = onode.key;
      dragParentId = onode.parentId;
      const sel = getSelectedONodes();
      // Drag tracks the specific OCCURRENCE(s): a multi-select drags exactly the selected
      // occurrence keys (so dragging one occurrence of a multi-membership node doesn't drag
      // its twins). Cross-pane PaneDragState still carries node ids (its contract).
      dragMultiKeys = (sel.length > 1 && sel.some(o => o.key === onode.key))
        ? sel.map(o => o.key) : null;
      // Populate the shared cross-pane drag state so a different pane can resolve the
      // dragged node(s) on drop. Movers carry their node + parent-at-dragstart.
      const dragONodes: ONode[] = dragMultiKeys
        ? dragMultiKeys.map(k => byKey.get(k)).filter((o): o is ONode => !!o)
        : [onode];
      ctx.paneDrag = {
        sourceToken: paneToken,
        nodeIds: dragONodes.map(o => o.node.id),
        movers: dragONodes.map(o => ({ node: o.node, oldParentId: o.parentId })),
        detachFromSource: (nodes) => detachNodes(nodes),
        awaitRealIds: () => Promise.all(dragONodes.map(o => awaitRealId(o))).then(() => {}),
      };
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', onode.node.id); }
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.style.opacity = '';
      dragReady = false;
      dragNodeId = null;
      dragKey = null;
      dragParentId = undefined;
      dragMultiKeys = null;
      ctx.paneDrag = null;
      // Clear indicators across ALL outliner panes (a cross-pane drag leaves them in the
      // target pane). Scoped to outliner lists so column-view rows are untouched.
      ctx.outer.querySelectorAll<HTMLElement>('[data-outliner-list] [data-node-id]:not(textarea)').forEach(r => {
        r.style.border = '2px solid transparent';
      });
      ctx.outer.querySelectorAll<HTMLElement>('[data-outliner-list] [data-drop-line]').forEach(l => l.remove());
    });
    // Drop zones by cursor Y: top 30% → before (same level), middle 40% → child of this
    // node, bottom 30% → after (same level).
    const dropZoneFor = (e: DragEvent): 'before' | 'child' | 'after' => {
      const r = row.getBoundingClientRect();
      const rel = (e.clientY - r.top) / r.height;
      return rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : 'child';
    };
    let dropLine: HTMLElement | null = null;
    const clearDropIndicator = () => {
      row.style.border = '2px solid transparent';
      if (dropLine) { dropLine.remove(); dropLine = null; }
    };
    const showDropIndicator = (zone: 'before' | 'child' | 'after') => {
      clearDropIndicator();
      if (zone === 'child') { row.style.border = '2px solid #4a9eff'; return; }
      // before/after: draw the blue insertion line starting at THIS row's indentation, so a
      // drop under a deeper-indented sibling aligns the line's left start with where the node
      // will land (rather than spanning the full width and looking ambiguous between levels).
      const indent = (onode.depth - baseDepth) * 20 + 6;
      if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
      const line = document.createElement('div');
      line.dataset.dropLine = '1';
      line.style.cssText = `position:absolute;left:${indent}px;right:0;height:2px;background:#4a9eff;pointer-events:none;${zone === 'before' ? 'top:-1px;' : 'bottom:-1px;'}`;
      row.appendChild(line);
      dropLine = line;
    };
    row.addEventListener('dragover', (e) => {
      const pd = ctx.paneDrag;
      if (!pd || dropBlockedBy(onode, pd)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      showDropIndicator(dropZoneFor(e));
    });
    row.addEventListener('dragleave', clearDropIndicator);
    row.addEventListener('drop', (e) => { void dropHandler(e); });
    const dropHandler = async (e: DragEvent) => {
      e.preventDefault();
      clearDropIndicator();
      const pd = ctx.paneDrag;
      if (!pd || dropBlockedBy(onode, pd)) return;

      // Resolve the drop target: a sibling position next to `onode`, or `onode` itself
      // as the new parent when dropping on the node body (middle zone).
      const zone = dropZoneFor(e);
      let newParentId: string | null;
      let newSibs: ONode[];
      let childDepth: number;
      if (zone === 'child') {
        await ensureChildren(onode);
        // Do NOT force-expand the drop target: dropping a node as a child should keep the
        // target's expand state as-is (collapsed stays collapsed, the child is added inside).
        newParentId = onode.node.id;
        newSibs = onode.children;
        childDepth = onode.depth + 1;
      } else {
        newParentId = onode.parentId;
        newSibs = getSiblings(onode);
        if (newSibs.indexOf(onode) === -1) return;
        childDepth = onode.depth;
      }
      // insert index is recomputed after removals below; seed for cross-pane (no removals)
      const insertAtFor = (): number => {
        if (zone === 'child') return newSibs.length;
        const tIdx = newSibs.indexOf(onode);
        return zone === 'before' ? tIdx : tIdx + 1;
      };

      if (pd.sourceToken === paneToken) {
        // ── Same-pane reorder / reparent (movers live in this pane's tree) ──
        // Resolve the dragged OCCURRENCE(s) by key, then exclude the target occurrence and
        // anything inside its subtree.
        const movers: ONode[] = (dragMultiKeys
          ? dragMultiKeys.map(k => byKey.get(k)).filter((o): o is ONode => !!o)
          : [(dragKey ? byKey.get(dragKey) : undefined) ?? anyOccOf(pd.nodeIds[0])].filter((o): o is ONode => !!o))
          .filter(o => o.key !== onode.key && !isInSubtree(onode, o));
        if (movers.length === 0) return;

        const topLevelDrop = zone !== 'child' && newSibs === roots;

        // Reparent / reorder. A top-level→top-level drop is just a same-parent reorder (newParentId
        // === the movers' current parent), so the link-toggle pass below no-ops for it. Row keys
        // equal node ids and don't change on reparent, so no re-keying is needed.
        // Capture each mover's pre-move parent NODE id for the link-toggle pass.
        const oldParents = new Map<ONode, string | null>(movers.map(o => [o, o.parentId]));
        for (const mover of movers) {
          const sibs = getSiblings(mover);
          const idx = sibs.indexOf(mover);
          if (idx >= 0) sibs.splice(idx, 1);
          if (mover.parentKey === null) { const ri = rootNodeList.indexOf(mover.node); if (ri >= 0) rootNodeList.splice(ri, 1); }
        }
        // Recompute insert index after removals (removals above the target shift it left).
        const at = insertAtFor();
        for (let i = 0; i < movers.length; i++) {
          const mover = movers[i];
          mover.parentId = newParentId;
          fixDepths(mover, childDepth);
          newSibs.splice(at + i, 0, mover);
          if (topLevelDrop) {
            mover.parentKey = null;
            rootNodeList.splice(Math.min(at + i, rootNodeList.length), 0, mover.node);
          } else {
            mover.parentKey = onode.key; // child zone → onode is the new parent row
          }
        }
        const affectedParents = new Set<string | null>([...oldParents.values(), newParentId]);
        render();

        await Promise.all(movers.map(m => awaitRealId(m)));
        // 新しい親への辺作成は await してから向き付け(apiMoveNode)を呼ぶ。並行のままだと向き付けが
        // 辺作成より先に届き、そのノードだけ向きが付かず＝「リンクなし」に落ちるレースが起きるため。
        const newLinks: Promise<unknown>[] = [];
        for (const mover of movers) {
          const oldPid = oldParents.get(mover) ?? null;
          if (oldPid !== newParentId) {
            if (oldPid !== null) void apiToggleLink(ctx.gId, mover.node.id, oldPid);
            if (newParentId !== null) newLinks.push(apiToggleLink(ctx.gId, mover.node.id, newParentId));
          }
        }
        if (newParentId !== null) {
          if (newLinks.length) await Promise.all(newLinks);
          void apiMoveNode(ctx.gId, movers[0].node.id, newParentId, 'down', newSibs.map(s => s.node.id));
        }
        // Reconcile every affected parent (old + new) to the DO once the writes settle.
        for (const pid of affectedParents) if (pid !== null) scheduleConfirm(pid);
      } else {
        // ── Cross-pane move (movers came from another pane) ──
        await moveAcrossPanes(pd, newParentId, newSibs, insertAtFor(), childDepth);
      }
    };

    // 各ノード右のコピーアイコン（旧・四角右クリックのコピーを移植）: ノード参照 [id]ラベル をコピー。
    const copyIcon = document.createElement('button');
    copyIcon.textContent = '❐';
    copyIcon.title = 'ノード参照をコピー';
    copyIcon.style.cssText = `flex-shrink:0;background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:12px;padding:0 6px;line-height:1;`;
    copyIcon.addEventListener('mousedown', (e) => e.preventDefault()); // don't steal caret/focus
    copyIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      const lbl = primaryLabel(onode.node, paneLang) ?? fallbackLabel(onode.node, paneLang) ?? '';
      void navigator.clipboard.writeText(`[${onode.node.id}]${lbl}`).then(() => showToast('コピーしました'));
    });

    row.appendChild(ta);
    row.appendChild(copyIcon);
    updateExpandMarker(onode);
    return row;
  };

  // Siblings of an occurrence = the children list of its PARENT OCCURRENCE (by parentKey),
  // or the pane roots when it's a top-level occurrence.
  const getSiblings = (onode: ONode): ONode[] =>
    onode.parentKey === null ? roots : (byKey.get(onode.parentKey)?.children ?? roots);

  const fixDepths = (o: ONode, d: number) => {
    o.depth = d;
    o.children.forEach(c => fixDepths(c, d + 1));
  };

  // True when `target` occurrence is `root` itself or lives within `root`'s subtree. Compared
  // by occurrence key so a multi-membership twin in another panel is NOT considered inside.
  const isInSubtree = (target: ONode, root: ONode): boolean => {
    if (target.key === root.key) return true;
    return root.children.some(c => isInSubtree(target, c));
  };

  // Insert nodes dragged from ANOTHER pane into this pane's tree at the given sibling
  // position, then reparent them in the graph. Source pane is updated via detachFromSource.
  const moveAcrossPanes = async (
    pd: NonNullable<typeof ctx.paneDrag>,
    newParentId: string | null,
    newSibs: ONode[],
    insertAt: number,
    targetDepth: number,
  ) => {
    // Never parent a node to itself (would create a self-loop edge and an infinite
    // parent-chain → a frozen tab). Happens when dropping/moving a node into a pane that
    // is showing that very node's children.
    const movers = pd.movers.filter(m => m.node.id !== newParentId);
    if (movers.length === 0) return;

    // Whether the moved nodes become top-level (root) occurrences in this pane.
    const intoRoots = newSibs === roots;
    // The parent occurrence key for child-level drops (newSibs is some parent's children
    // array). Resolve it from the destination parent node id.
    const parentOcc = intoRoots ? null : anyOccOf(newParentId ?? '');
    const parentKey = intoRoots ? null : (parentOcc?.key ?? null);

    // Guard against duplicate occurrences: if a mover already occupies this exact sibling
    // slot (same node id among newSibs), remove the existing entry first so the node appears
    // once. Otherwise the order sent to apiMoveNode would contain a duplicate id.
    for (const m of movers) {
      const ex = newSibs.findIndex(s => s.node.id === m.node.id);
      if (ex >= 0) {
        unindexOcc(newSibs[ex]);
        if (intoRoots) { const ri = rootNodeList.indexOf(newSibs[ex].node); if (ri >= 0) rootNodeList.splice(ri, 1); }
        newSibs.splice(ex, 1); if (ex < insertAt) insertAt--;
      }
    }

    const inserted: ONode[] = [];
    for (const m of movers) {
      const key = intoRoots ? rootKey(null, m.node.id) : childKey(parentKey ?? '', m.node.id);
      inserted.push(make(m.node, newParentId, targetDepth, key, parentKey));
    }
    for (let i = 0; i < inserted.length; i++) {
      newSibs.splice(insertAt + i, 0, inserted[i]);
      if (intoRoots) { rootNodeList.splice(Math.min(insertAt + i, rootNodeList.length), 0, inserted[i].node); }
    }

    // Invalidate caches for source + target parents so other views refetch fresh data.
    render();

    // Remove the nodes from the source pane (re-renders it).
    pd.detachFromSource(movers.map(m => m.node));

    // Resolve any temp ids before hitting the API.
    await pd.awaitRealIds();
    // 新しい親への辺作成を await してから向き付け（レースで向きが付かず＝リンクなし化するのを防ぐ）。
    const newLinks: Promise<unknown>[] = [];
    for (const m of movers) {
      const oldPid = m.oldParentId;
      if (oldPid !== newParentId) {
        if (oldPid !== null) void apiToggleLink(ctx.gId, m.node.id, oldPid);
        if (newParentId !== null) newLinks.push(apiToggleLink(ctx.gId, m.node.id, newParentId));
      }
    }
    if (newParentId !== null) {
      if (newLinks.length) await Promise.all(newLinks);
      void apiMoveNode(ctx.gId, movers[0].node.id, newParentId, 'down', newSibs.map(s => s.node.id));
      scheduleConfirm(newParentId); // reconcile the destination pane to the DO after the move
    }
  };

  // ── Keyboard-driven cross-pane node move (Ctrl/Cmd+→/←) ───────────────
  // Reuses the drag-and-drop cross-pane primitives: the source pane publishes the node into
  // ctx.paneDrag (beginKeyMove), then the target pane consumes it (acceptKeyMove via
  // moveAcrossPanes) so reparent / detach / persistence behave identically to a drag.
  const beginKeyMove = (nodeId: string): boolean => {
    const o = anyOccOf(nodeId);
    if (!o) return false;
    ctx.paneDrag = {
      sourceToken: paneToken,
      nodeIds: [o.node.id],
      movers: [{ node: o.node, oldParentId: o.parentId }],
      detachFromSource: (nodes) => detachNodes(nodes),
      awaitRealIds: () => awaitRealId(o).then(() => {}),
    };
    return true;
  };

  // The parent whose children this pane currently displays (null = no concrete parent,
  // e.g. a bookmarks-only root or an empty pane-sourced pane → cannot accept a move).
  const getEffectiveParentId = (): string | null =>
    paneParentSet ? paneParentId : ctx.rootNodeId;

  // The current parent of a node living in this pane's tree (undefined if not present).
  const getNodeParentId = (nodeId: string): string | null | undefined =>
    anyOccOf(nodeId)?.parentId;

  const acceptKeyMove = async (): Promise<void> => {
    const pd = ctx.paneDrag;
    if (!pd || pd.sourceToken === paneToken) return;
    const targetParentId = getEffectiveParentId();
    if (targetParentId === null) return;
    // Same parent → nothing to reparent; skip to avoid a duplicate insertion that would
    // corrupt the sibling chain (callers also guard, this is defence-in-depth).
    if ((pd.movers[0]?.oldParentId ?? null) === targetParentId) return;
    const movedId = pd.nodeIds[0];
    await moveAcrossPanes(pd, targetParentId, roots, roots.length, baseDepth);
    const o = anyOccOf(movedId);
    if (o) focusRow(o);
  };

  // List-level drop surface: a cross-pane drag that lands in the empty area / below the
  // last row (or onto an empty pane) appends the node(s) to this pane's root level.
  const isOverRow = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('[data-node-id]');
  listEl.addEventListener('dragover', (e) => {
    const pd = ctx.paneDrag;
    if (!pd || pd.sourceToken === paneToken) return; // same-pane handled by rows
    if (isOverRow(e.target)) return;                 // a row handles its own zone
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    listEl.style.boxShadow = 'inset 0 -2px 0 0 #4a9eff';
  });
  listEl.addEventListener('dragleave', (e) => {
    if (!listEl.contains(e.relatedTarget as Node | null)) listEl.style.boxShadow = '';
  });
  listEl.addEventListener('drop', (e) => {
    const pd = ctx.paneDrag;
    listEl.style.boxShadow = '';
    if (!pd || pd.sourceToken === paneToken) return;
    if (isOverRow(e.target)) return; // the row's own drop handler takes it
    e.preventDefault();
    const targetParentId = paneParentSet ? paneParentId : null;
    void moveAcrossPanes(pd, targetParentId, roots, roots.length, baseDepth);
  });


  // ── Link-search (/) ──────────────────────────────────────────────────

  const doLinkSearch = (onode: ONode) => {
    // Close any existing search panel
    (listEl.querySelector('[data-link-search]') as HTMLElement | null)?.remove();

    const row = rowMap.get(onode.key);
    if (!row) return;
    const ta = row.querySelector<HTMLTextAreaElement>('textarea');
    if (!ta) return;

    // Hide textarea, insert search input in its place within the same flex row
    ta.style.display = 'none';
    row.style.position = 'relative';

    const slash = document.createElement('span');
    slash.textContent = '/';
    slash.style.cssText = `flex-shrink:0;color:${TEXT_DIM};font-size:15px;line-height:1.8;padding-right:2px;`;

    const inp = document.createElement('input');
    inp.dataset.linkSearch = '1';
    inp.type = 'text';
    inp.style.cssText = `flex:1;background:transparent;border:none;outline:none;color:${TEXT_HIGH};font-size:15px;font-family:inherit;line-height:1.8;padding:0;`;

    row.append(slash, inp);

    // Dropdown appears below the row, left edge aligned with textarea start
    const textLeft = (onode.depth - baseDepth) * 20 + 24;
    const drop = document.createElement('div');
    drop.style.cssText = `position:absolute;left:${textLeft}px;top:100%;z-index:20;min-width:240px;max-width:360px;max-height:200px;overflow-y:auto;background:hsl(240,14%,9%);border:1px solid ${BORDER};border-radius:4px;`;
    row.appendChild(drop);

    inp.focus();

    let resultNodes: ExplorerNode[] = [];
    let selIdx = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const restoreRow = () => {
      drop.remove(); slash.remove(); inp.remove();
      ta.style.display = '';
      row.style.position = '';
    };

    const close = () => { restoreRow(); focusRow(onode); };

    const highlight = () => {
      ([...drop.children] as HTMLElement[]).forEach((el, i) => {
        el.style.background = i === selIdx ? 'rgba(99,102,241,0.12)' : 'transparent';
        el.style.color = i === selIdx ? TEXT_HIGH : TEXT_MID;
      });
    };

    const doLink = (node: ExplorerNode) => {
      const oldId = onode.node.id;
      const wasRoot = onode.parentKey === null;
      const oldNode = onode.node;
      restoreRow();

      // Replace this row's underlying node with the found node, then re-index under the new id
      // (the row key is just the node id): unindex under the old id, swap, re-index.
      unindexOcc(onode);
      rowMap.delete(onode.key);
      onode.node = node;
      onode.key = node.id;
      indexOcc(onode);
      row.dataset.nodeId = node.id;
      row.dataset.occKey = onode.key;
      rowMap.set(onode.key, row);
      if (wasRoot) { const ri = rootNodeList.indexOf(oldNode); if (ri >= 0) rootNodeList[ri] = node; }

      // Update textarea to show found node's label
      ta.value = (primaryLabel(node, paneLang) ?? fallbackLabel(node, paneLang)) || '';

      // Delete old placeholder node; link the found node to the parent AND orient it under that
      // parent. ドラッグでの再親付けと同じ手順: toggleLink で辺を作り、move で親向き(h_orientation)と
      // 並び順を確定する。orient しないと親を持たない扱いのままで「リンクなし」から消えないため。
      const edgeTarget = onode.parentId ?? ctx.rootNodeId;
      const sibIds = getSiblings(onode).map(s => s.node.id);
      void (async () => {
        await apiDeleteNode(ctx.gId, oldId);
        if (edgeTarget) {
          await apiToggleLink(ctx.gId, node.id, edgeTarget);
          await apiMoveNode(ctx.gId, node.id, edgeTarget, 'down', sibIds);
        }
      })();

      focusRow(onode);
    };

    inp.addEventListener('input', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = inp.value.trim();
        drop.innerHTML = ''; selIdx = 0; resultNodes = [];
        if (!q) return;
        const lang = ctx.state.showFallback ? undefined : paneLang;
        const { nodes } = await fetchAllNodes(ctx.gId, [], 0, lang, undefined, q, 20);
        // Exclude only the row being linked, its parent, and nodes already linked as
        // siblings (re-linking an existing sibling would toggle its edge off). Other
        // matches — including the exact-word node itself — should appear even when the
        // same node is visible elsewhere in the pane.
        const excl = new Set<string>([onode.node.id]);
        if (onode.parentId) excl.add(onode.parentId);
        for (const s of getSiblings(onode)) excl.add(s.node.id);
        resultNodes = nodes.filter(n => !excl.has(n.id));
        for (let i = 0; i < resultNodes.length; i++) {
          const n = resultNodes[i];
          const lbl = (primaryLabel(n, paneLang) ?? fallbackLabel(n, paneLang)) || n.id.slice(0, 8);
          const item = document.createElement('div');
          item.textContent = lbl;
          item.style.cssText = `padding:5px 12px;cursor:pointer;font-size:14px;color:${TEXT_MID};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
          item.addEventListener('mouseenter', () => { selIdx = i; highlight(); });
          item.addEventListener('click', () => doLink(n));
          drop.appendChild(item);
        }
        highlight();
      }, 200);
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(selIdx + 1, resultNodes.length - 1); highlight(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); highlight(); return; }
      if (e.key === 'Enter' && resultNodes[selIdx]) { e.preventDefault(); doLink(resultNodes[selIdx]); }
    });
  };

  // ── Multi-select operations ───────────────────────────────────────────

  const doDeleteMulti = async () => {
    const sel = getSelectedONodes();
    if (sel.length === 0) return;
    // Delete acts on NODES. Per node: if it sits in multiple places (>1 oriented parent), only the
    // SELECTED occurrence's edge is unlinked (entity survives). Otherwise it's the last place → entity
    // delete, blocked when relation texts are attached.
    const selNodeIds = new Set(sel.map(n => n.node.id));
    // Focus target in VISIBLE (DOM) order, keyed by occurrence: first non-selected row above
    // the block, else below it.
    const selKeys = new Set(sel.map(n => n.key));
    const rows = [...listEl.querySelectorAll<HTMLElement>('[data-occ-key]')];
    const selRowIdxs = rows.map((r, idx) => (selKeys.has(r.dataset.occKey ?? '') ? idx : -1)).filter(idx => idx >= 0);
    const firstRowIdx = selRowIdxs.length ? Math.min(...selRowIdxs) : -1;
    const lastRowIdx = selRowIdxs.length ? Math.max(...selRowIdxs) : -1;
    let targetKey: string | null = null;
    for (let k = firstRowIdx - 1; k >= 0; k--) { const key = rows[k]?.dataset.occKey; if (key && !selKeys.has(key)) { targetKey = key; break; } }
    if (!targetKey) for (let k = lastRowIdx + 1; k < rows.length; k++) { const key = rows[k]?.dataset.occKey; if (key && !selKeys.has(key)) { targetKey = key; break; } }
    // 選択されたノードごとに、その選択オカレンスを1つ保持（親エッジ解除の対象）。
    const selOccByNode = new Map<string, ONode>();
    for (const o of sel) if (!selOccByNode.has(o.node.id)) selOccByNode.set(o.node.id, o);
    clearSelection();
    // 配置数を先に並列取得（親エッジ解除 vs 実体削除の判定用）。
    const parentCount = new Map<string, number>();
    await Promise.all([...selOccByNode.entries()].map(async ([nodeId, occ]) => {
      if (occ.parentId && occ.parentId !== ORPHAN_ID) parentCount.set(nodeId, await fetchPlacementCount(ctx.gId, nodeId));
    }));
    const delPromises: Promise<boolean>[] = [];
    for (const nodeId of selNodeIds) {
      const occ = selOccByNode.get(nodeId)!;
      const parentId = occ.parentId;
      // 複数箇所 → この箇所だけ解除。
      if (parentId && parentId !== ORPHAN_ID && (parentCount.get(nodeId) ?? 1) > 1) {
        // Unlink only this occurrence's edge; entity survives elsewhere → drop this subtree, no promote.
        const sibs = getSiblings(occ);
        const idx = sibs.indexOf(occ); if (idx !== -1) sibs.splice(idx, 1);
        unindexSubtree(occ);
        void apiUnlinkNode(ctx.gId, nodeId, parentId);
        if (parentId) scheduleConfirm(parentId);
        continue;
      }
      // 最後の1箇所 → 実体削除。関係テキストが紐づくノードはバックエンドが 409 で拒否するので、
      // 楽観削除→失敗なら下の load() で復元される（フロントの件数事前チェックは廃止）。
      for (const n of occsOf(nodeId)) {
        promoteChildren(n);
        const sibs = getSiblings(n);
        const idx = sibs.indexOf(n); if (idx !== -1) sibs.splice(idx, 1);
        if (n.parentKey === null) { const ri = rootNodeList.indexOf(n.node); if (ri >= 0) rootNodeList.splice(ri, 1); }
        unindexOcc(n);
      }
      const promoteTo = parentId && parentId !== ORPHAN_ID && !selNodeIds.has(parentId) ? parentId : undefined;
      delPromises.push(apiDeleteNode(ctx.gId, nodeId, promoteTo).then(res => res.ok));
      if (parentId) scheduleConfirm(parentId);
    }
    render();
    const target = targetKey ? byKey.get(targetKey) : undefined;
    if (target) focusRow(target);
    if (delPromises.length) void Promise.all(delPromises).then(oks => {
      if (oks.some(ok => !ok)) { showToast('関係テキストが紐づくため削除できないノードがありました'); void load(); }
    });
  };

  // ── Reorder write coalescing (B) ──────────────────────────────────────
  // Holding Shift+Alt+↑/↓ used to fire one fire-and-forget apiMoveNode PER step. Those
  // full-order PATCHes have no arrival-order guarantee, so an intermediate order could win
  // on the backend ("moved 10, reload shows 9"), and the many concurrent chain rebuilds
  // were slow and could corrupt the chain. We coalesce per parent: keep only a debounce
  // timer and send ONE PATCH with the final order once moves settle.
  const REORDER_DEBOUNCE_MS = 300;
  const reorderTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Live sibling id order for a parent, read straight from the tree (so temp ids that have
  // since resolved are picked up). For the pane top level we send rootNodeList (the canonical
  // one-per-node order) rather than `roots`, which holds duplicate node ids across panels.
  // For a child parent, use any occurrence's children (unique node ids
  // within that subtree).
  const siblingIdsForParent = (parentId: string): string[] => {
    if (parentId === rootParentNodeId) return rootNodeList.map(n => n.id);
    const occ = anyOccOf(parentId);
    return (occ?.children ?? roots).map(s => s.node.id);
  };

  const sendReorder = (parentId: string, keepalive = false): Promise<void> => {
    const order = siblingIdsForParent(parentId);
    if (order.length === 0) return Promise.resolve();
    return apiMoveNode(ctx.gId, order[0], parentId, 'down', order, keepalive);
  };

  const flushReorder = async (parentId: string) => {
    // Never send a temp id — wait for any pending creates in this sibling set to resolve.
    const ids = siblingIdsForParent(parentId);
    await Promise.all(ids.map(id => { const o = anyOccOf(id); return o ? awaitRealId(o) : Promise.resolve(); }));
    await sendReorder(parentId);
    scheduleConfirm(parentId); // reconcile the view to the DO once the reorder has landed
  };

  const queueReorder = (parentId: string | null) => {
    if (parentId === null) return; // bookmark/root-null level uses apiMoveBookmark per step
    const t = reorderTimers.get(parentId);
    if (t) clearTimeout(t);
    reorderTimers.set(parentId, setTimeout(() => { reorderTimers.delete(parentId); void flushReorder(parentId); }, REORDER_DEBOUNCE_MS));
  };

  // Flush every pending reorder immediately (best-effort). keepalive lets it survive a
  // page navigation/reload that happens before the debounce fires.
  const flushPendingReorders = (keepalive = false) => {
    if (reorderTimers.size === 0) return;
    const parents = [...reorderTimers.keys()];
    for (const t of reorderTimers.values()) clearTimeout(t);
    reorderTimers.clear();
    for (const pid of parents) void sendReorder(pid, keepalive);
  };
  const onPageHide = () => flushPendingReorders(true);
  window.addEventListener('pagehide', onPageHide);

  // ── Confirm-refetch reconciliation ────────────────────────────────────
  // After a structural write settles, refetch the affected parent's children ONCE and reconcile
  // the view to the DO (the single source of truth). This snaps a lost/mangled write back to the
  // real state within ~400ms instead of only on reload — the session-time half of "no revert".
  const CONFIRM_DEBOUNCE_MS = 400;
  const confirmTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // The sibling ONode list for a parent id: the pane's top level (roots) when parentId is the pane
  // parent, else the parent occurrence's children. null when the parent isn't currently visible.
  const siblingListFor = (parentId: string): { parent: ONode | null; list: ONode[] } | null => {
    if (parentId === rootParentNodeId) return { parent: null, list: roots };
    const occ = anyOccOf(parentId);
    return occ ? { parent: occ, list: occ.children } : null;
  };

  // Apply the same top-level transforms load() uses (pane-parent exclusion / synthetic リンクなし)
  // so a top-level confirm doesn't drop the orphan row or re-show the pane parent.
  const transformTopLevel = (fresh: ExplorerNode[]): ExplorerNode[] => {
    if (paneParentSet) return paneParentId ? fresh.filter(n => n.id !== paneParentId) : fresh;
    if (ctx.rootNodeId) return fresh.some(n => n.id === ORPHAN_ID) ? fresh : [...fresh, { id: ORPHAN_ID, ja: ORPHAN_LABEL }];
    return fresh;
  };

  // Reconcile a parent's displayed children to `fresh` (DO order + membership), REUSING existing
  // ONodes by id so their expand state + already-loaded subtree survive. New nodes are added
  // collapsed; vanished nodes (and their subtrees) are dropped. Excludes ancestors/self and nodes
  // already placed elsewhere in this pane, exactly like ensureChildren.
  const reconcileSiblings = (parent: ONode | null, fresh: ExplorerNode[]) => {
    const parentId = parent ? parent.node.id : rootParentNodeId;
    const depth = parent ? parent.depth + 1 : baseDepth;
    const parentKey = parent ? parent.key : null;
    const list = parent ? parent.children : roots;
    const ownIds = new Set(list.map(o => o.node.id));
    const bySurviving = new Map(list.map(o => [o.node.id, o] as const));
    const excl = new Set<string>();
    if (parent) { for (const a of ancestorIds(parent)) excl.add(a); excl.add(parent.node.id); }
    const freshIds = new Set(fresh.map(n => n.id));
    for (const o of list) if (!freshIds.has(o.node.id)) unindexSubtree(o); // drop rows gone from DO
    const next: ONode[] = [];
    for (const n of fresh) {
      if (excl.has(n.id)) continue;
      if (byKey.has(n.id) && !ownIds.has(n.id)) continue; // already placed elsewhere in this pane
      const existing = bySurviving.get(n.id);
      if (existing) {
        Object.assign(existing.node, n); // refresh labels/color
        existing.depth = depth; existing.parentId = parentId; existing.parentKey = parentKey;
        next.push(existing);
      } else {
        next.push(make(n, parentId, depth, n.id, parentKey));
      }
    }
    if (parent) parent.children = next;
    else { roots = next; rootNodeList = next.map(o => o.node); }
    render();
  };

  // true when the caret sits inside parentId's displayed subtree — defer the confirm so an edit
  // (or the row currently being renamed) is never clobbered.
  const focusInSubtree = (parentId: string): boolean => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !listEl.contains(active)) return false;
    if (parentId === rootParentNodeId) return true; // any list focus defers a top-level confirm
    const key = active.closest<HTMLElement>('[data-occ-key]')?.dataset.occKey;
    const focused = key ? byKey.get(key) : undefined;
    const parent = anyOccOf(parentId);
    return !!(focused && parent && isInSubtree(focused, parent));
  };

  const confirmChildren = async (parentId: string) => {
    if (reorderTimers.has(parentId)) { scheduleConfirm(parentId); return; } // let the pending write land first
    const sl = siblingListFor(parentId);
    if (!sl) return; // parent not visible → nothing to reconcile
    await Promise.all(sl.list.map(o => awaitRealId(o))); // never fetch while a temp id is in flight
    let fresh = await fetchChildrenFiltered(parentId);
    if (fresh.length === 0 && sl.list.length > 0) return; // suspected transient error — keep the view
    if (parentId === rootParentNodeId) fresh = transformTopLevel(fresh);
    if (focusInSubtree(parentId)) { scheduleConfirm(parentId); return; } // don't clobber an edit
    const cur = siblingListFor(parentId); // re-read: may have changed while awaiting
    if (cur) reconcileSiblings(cur.parent, fresh);
  };

  const scheduleConfirm = (parentId: string | null) => {
    if (parentId === null || parentId === ORPHAN_ID) return; // bookmark/root-null + synthetic: no /children
    const t = confirmTimers.get(parentId);
    if (t) clearTimeout(t);
    confirmTimers.set(parentId, setTimeout(() => { confirmTimers.delete(parentId); void confirmChildren(parentId); }, CONFIRM_DEBOUNCE_MS));
  };

  const doMoveMulti = async (direction: 'up' | 'down') => {
    const sel = getSelectedONodes();
    if (sel.length <= 1) return;
    const parentId = sel[0].parentId;
    if (!sel.every(n => n.parentId === parentId)) return;
    // Top-level reorder: operate on the canonical rootNodeList order (panels are a display
    // grouping, not a sibling chain), then re-render. Cross-panel keyboard moves are out of
    // scope here — dragging is the relink path.
    if (roots.includes(sel[0])) {
      const selNodes = sel.map(n => n.node);
      const idxs = selNodes.map(n => rootNodeList.indexOf(n)).sort((a, b) => a - b);
      const lo = idxs[0], hi = idxs[idxs.length - 1];
      if (direction === 'up' && lo > 0) {
        const moved = rootNodeList.splice(lo, hi - lo + 1);
        rootNodeList.splice(lo - 1, 0, ...moved);
      } else if (direction === 'down' && hi < rootNodeList.length - 1) {
        const moved = rootNodeList.splice(lo, hi - lo + 1);
        rootNodeList.splice(lo + 1, 0, ...moved);
      } else return;
      buildRoots();
      render();
      const back = anyOccOf(selNodes[0].id); if (back) focusRow(back);
      if (rootParentNodeId !== null) queueReorder(rootParentNodeId);
      return;
    }
    const sibs = getSiblings(sel[0]);
    const minIdx = Math.min(...sel.map(n => sibs.indexOf(n)));
    const maxIdx = Math.max(...sel.map(n => sibs.indexOf(n)));

    // Same-parent reorder
    if (direction === 'up' && minIdx > 0) {
      const displaced = sibs[minIdx - 1];
      sibs.splice(minIdx - 1, 1); sibs.splice(maxIdx, 0, displaced);
      const displacedRows = visibleRowGroup(displaced);
      let anchor: HTMLElement | undefined = lastDescRow(sel[sel.length - 1]);
      if (!anchor) return;
      for (const r of displacedRows) { anchor.insertAdjacentElement('afterend', r); anchor = r; }
      updateSelectionHighlight();
      if (parentId !== null) queueReorder(parentId);
      return;
    }
    if (direction === 'down' && maxIdx < sibs.length - 1) {
      const displaced = sibs[maxIdx + 1];
      sibs.splice(maxIdx + 1, 1); sibs.splice(minIdx, 0, displaced);
      const displacedRows = visibleRowGroup(displaced);
      const firstGroupRow = rowMap.get(sel[0].key);
      if (!firstGroupRow) return;
      for (const r of displacedRows) listEl.insertBefore(r, firstGroupRow);
      updateSelectionHighlight();
      if (parentId !== null) queueReorder(parentId);
      return;
    }

    // Cross-hierarchy: move group to adjacent uncle
    if (parentId === null) return;
    const parentONode = sel[0].parentKey ? byKey.get(sel[0].parentKey) : undefined;
    if (!parentONode) return;
    const parentSibs = getSiblings(parentONode);
    const parentIdx = parentSibs.indexOf(parentONode);
    const targetParentIdx = parentIdx + (direction === 'down' ? 1 : -1);
    if (targetParentIdx < 0 || targetParentIdx >= parentSibs.length) return;
    const targetParent = parentSibs[targetParentIdx];
    const oldParentId = parentId;

    if (!targetParent.childrenLoaded) await ensureChildren(targetParent);

    // Remove group from old parent (iterate descending to avoid index shift)
    const selSet = new Set(sel);
    for (let i = sibs.length - 1; i >= 0; i--) { if (selSet.has(sibs[i])) sibs.splice(i, 1); }

    // Re-parent and fix depths (row keys equal node ids, so no re-keying needed).
    const newDepth = targetParent.depth + 1;
    for (const n of sel) {
      n.parentId = targetParent.node.id;
      n.parentKey = targetParent.key;
      fixDepths(n, newDepth);
    }

    if (direction === 'down') targetParent.children.unshift(...sel);
    else targetParent.children.push(...sel);
    targetParent.expanded = true;

    render();
    if (sel[0]) focusRow(sel[0]);

    await Promise.all(sel.map(n => awaitRealId(n)));
    // 新親への辺作成を await → queueReorder で順序＋向き付けを永続化（未実施だとリロードで位置が戻る）。
    const newLinks: Promise<unknown>[] = [];
    for (const n of sel) {
      void apiToggleLink(ctx.gId, n.node.id, oldParentId);
      newLinks.push(apiToggleLink(ctx.gId, n.node.id, targetParent.node.id));
    }
    await Promise.all(newLinks);
    queueReorder(targetParent.node.id); // targetParent confirmed via flushReorder
    scheduleConfirm(oldParentId);       // reconcile the parent the group left
  };

  const doTabMulti = async (sel: ONode[], dedent: boolean) => {
    if (dedent) {
      for (const n of sel) { if (byKey.has(n.key)) await doDedent(n); }
    } else {
      for (const n of [...sel].reverse()) {
        if (!byKey.has(n.key)) continue;
        const v = flatVisible(); const ii = v.indexOf(n);
        if (ii > 0) await doIndent(n, v, ii);
      }
    }
  };

  // ── Node operations ───────────────────────────────────────────────────

  const doAddSibling = async (onode: ONode, before = false, opts?: { text?: string }): Promise<ONode | null> => {
    const tempId = `temp-${++ctx.tempNodeCounter}`;
    const initialText = opts?.text ?? '';
    const tempNode: ExplorerNode = initialText ? { id: tempId, [paneLang]: initialText } : { id: tempId };
    const sibs = getSiblings(onode);
    const idx = sibs.indexOf(onode);
    // Capture previous sibling before splice (needed when inserting before the first node)
    const prevSibNode = before && idx > 0 ? sibs[idx - 1] : undefined;
    const isRoot = onode.parentKey === null;
    // New sibling shares onode's parent row.
    const tempKey = rootKey(null, tempId);
    const no = make(tempNode, onode.parentId, onode.depth, tempKey, onode.parentKey);
    no.childrenLoaded = true;
    sibs.splice(before ? idx : idx + 1, 0, no);
    if (isRoot) { const ai = rootNodeList.indexOf(onode.node); rootNodeList.splice(ai < 0 ? rootNodeList.length : (before ? ai : ai + 1), 0, tempNode); }

    const cleanupTemp = () => {
      sibs.splice(sibs.indexOf(no), 1); unindexOcc(no);
      if (isRoot) { const ri = rootNodeList.indexOf(tempNode); if (ri >= 0) rootNodeList.splice(ri, 1); }
    };

    let newRow: HTMLElement;
    if (before) {
      const ownRow = rowMap.get(onode.key);
      if (!ownRow) { cleanupTemp(); return null; }
      newRow = buildRow(no);
      ownRow.insertAdjacentElement('beforebegin', newRow);
    } else {
      const anchor = lastDescRow(onode);
      if (!anchor) { cleanupTemp(); return null; }
      newRow = buildRow(no);
      anchor.insertAdjacentElement('afterend', newRow);
    }
    focusRow(no);

    // Register promise so operations on this temp node can wait for the real ID
    let resolveTemp!: () => void;
    tempReady.set(tempId, new Promise<void>(res => { resolveTemp = res; }));

    // For "before first node" (no prevSib), insertAfterId=undefined → backend appends, then reorder
    const insertAfterId = before ? prevSibNode?.node.id : onode.node.id;
    const nn = await apiCreateNode(ctx.gId, onode.parentId, paneLang, initialText, insertAfterId);
    if (!nn) {
      resolveTemp();
      tempReady.delete(tempId);
      newRow.remove(); rowMap.delete(no.key);
      cleanupTemp();
      focusRow(onode);
      return null;
    }

    const typedText = newRow.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '';
    // temp id → real id: swap the row's id + key + index + row element.
    swapNodeId(no, tempId, nn.id, nn.id);
    Object.assign(tempNode, nn); // copy labels/color (id already real via swapNodeId)
    resolveTemp();
    tempReady.delete(tempId);

    // If inserting before the first node, the backend appended it to chain end → move to front
    if (before && !prevSibNode && onode.parentId !== null) {
      void apiMoveNode(ctx.gId, nn.id, onode.parentId, 'up', siblingIdsForParent(onode.parentId));
    }

    // Persist later edits, but skip when the label already matches what we created with (paste path).
    if (typedText.trim() && typedText.trim() !== initialText.trim()) void apiUpdateNode(ctx.gId, nn.id, paneLang, typedText);
    return no;
  };

  // 削除するノード o の（読み込み済みの）子を、o の親（＝子から見た祖父母）の位置へ昇格させる。
  // o 自体はこの後で除去される。DOM は呼び出し側の render() で再構築する。
  const promoteChildren = (o: ONode) => {
    const kids = o.children;
    if (kids.length === 0) return;
    const sibs = getSiblings(o);              // o の親の子配列（＝祖父母の子）
    let at = sibs.indexOf(o);
    if (at < 0) at = sibs.length - 1;
    const toRoot = o.parentKey === null;
    const rootAt = toRoot ? rootNodeList.indexOf(o.node) : -1;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      c.parentId = o.parentId;
      c.parentKey = o.parentKey;
      fixDepths(c, o.depth);
      if (toRoot) {
        rootNodeList.splice((rootAt < 0 ? rootNodeList.length : rootAt + 1 + i), 0, c.node);
      }
      sibs.splice(at + 1 + i, 0, c);          // o の直後に順に差し込む（o 除去後にその位置を継ぐ）
    }
    o.children = [];
  };

  const doDelete = async (onode: ONode, _visIdx: number, _vis: ONode[]) => {
    const nodeId = onode.node.id;
    const parentId = onode.parentId;
    // Pick the focus target from the VISIBLE (DOM) order by occurrence key — capture the DOM
    // neighbour (row above, else below) of THIS occurrence while it's still in the list.
    const rowEl = rowMap.get(onode.key);
    let targetKey: string | null = null;
    if (rowEl) {
      const rows = [...listEl.querySelectorAll<HTMLElement>('[data-occ-key]')];
      const di = rows.indexOf(rowEl);
      targetKey = (rows[di - 1] ?? rows[di + 1])?.dataset.occKey ?? null;
    }
    const focusTarget = () => { const t = targetKey ? byKey.get(targetKey) : undefined; if (t) focusRow(t); };

    // ── 複数箇所に配置されたノードは、この箇所（親エッジ）だけリンク解除し、実体と他の箇所は残す ──
    // 削除するのは「最後の1箇所」のときだけ。判定は配置数（向き付き親に限らない実際の出現数）。
    if (parentId && parentId !== ORPHAN_ID) {
      const placements = await fetchPlacementCount(ctx.gId, nodeId);
      if (placements > 1) {
        // Unlink ONLY this occurrence's parent edge. The node (with its children) survives under its
        // other parent(s), so remove this occurrence's whole subtree from the UI — do NOT promote.
        const sibs = getSiblings(onode);
        const si = sibs.indexOf(onode); if (si >= 0) sibs.splice(si, 1);
        unindexSubtree(onode);
        render();
        focusTarget();
        void apiUnlinkNode(ctx.gId, nodeId, parentId);
        if (parentId) scheduleConfirm(parentId);
        return;
      }
    }

    // ── 最後の1箇所 → 実体削除。関係テキストが紐づくノードはバックエンドが 409 で拒否するので、
    // 楽観削除→失敗なら下で load() 復元＋トースト（フロントの件数事前チェックは廃止）。
    // 子は祖父母（このノードの親）へ昇格させる。親が無い/リンクなし配下なら昇格先なし。
    const promoteTo = parentId && parentId !== ORPHAN_ID ? parentId : undefined;
    for (const o of occsOf(nodeId)) {
      promoteChildren(o);
      const sibs = getSiblings(o);
      const si = sibs.indexOf(o); if (si >= 0) sibs.splice(si, 1);
      if (o.parentKey === null) { const ri = rootNodeList.indexOf(o.node); if (ri >= 0) rootNodeList.splice(ri, 1); }
      unindexOcc(o);
    }
    render();
    focusTarget();
    const res = await apiDeleteNode(ctx.gId, nodeId, promoteTo);
    if (res.ok) { if (parentId) scheduleConfirm(parentId); } // reconcile parent (promoted children) with the DO
    if (!res.ok) {
      // Backend guard (or other failure): restore the optimistically-removed rows.
      if (res.relationCount && res.relationCount > 0) {
        showToast(`関係テキストが${res.relationCount}件紐づくため削除できません（先に関係を外してください）`);
      } else {
        showToast('削除できませんでした');
      }
      void load();
    }
  };

  const doMove = async (onode: ONode, direction: 'up' | 'down') => {
    // Top-level reorder: reorder the canonical rootNodeList, then re-render. (Panels are a
    // display grouping; cross-panel keyboard moves are out of scope — dragging relinks.)
    if (roots.includes(onode)) {
      const ri = rootNodeList.indexOf(onode.node);
      const ni = ri + (direction === 'up' ? -1 : 1);
      if (ri < 0 || ni < 0 || ni >= rootNodeList.length) return;
      rootNodeList.splice(ri, 1);
      rootNodeList.splice(ni, 0, onode.node);
      buildRoots();
      render();
      const back = anyOccOf(onode.node.id); if (back) focusRow(back);
      if (onode.parentId === null) void apiMoveBookmark(ctx.gId, onode.node.id, direction);
      else if (rootParentNodeId !== null) queueReorder(rootParentNodeId);
      return;
    }

    const sibs = getSiblings(onode);
    const idx = sibs.indexOf(onode);
    const newIdx = idx + (direction === 'up' ? -1 : 1);

    if (newIdx >= 0 && newIdx < sibs.length) {
      const neighbor = sibs[newIdx];
      sibs.splice(idx, 1); sibs.splice(newIdx, 0, onode);
      const group = visibleRowGroup(onode);
      if (direction === 'up') {
        const neighborRow = rowMap.get(neighbor.key);
        if (!neighborRow) return;
        for (const r of group) listEl.insertBefore(r, neighborRow);
      } else {
        const anchor = lastDescRow(neighbor);
        if (!anchor) return;
        let insertAfter: HTMLElement = anchor;
        for (const r of group) { insertAfter.insertAdjacentElement('afterend', r); insertAfter = r; }
      }
      focusRow(onode);
      if (onode.parentId === null) void apiMoveBookmark(ctx.gId, onode.node.id, direction);
      else queueReorder(onode.parentId);
      return;
    }

    // Cross-hierarchy: move to adjacent uncle node
    if (onode.parentId === null || onode.parentKey === null) return;
    const parentONode = byKey.get(onode.parentKey);
    if (!parentONode) return;
    const parentSibs = getSiblings(parentONode);
    const parentIdx = parentSibs.indexOf(parentONode);
    const targetParentIdx = parentIdx + (direction === 'down' ? 1 : -1);
    if (targetParentIdx < 0 || targetParentIdx >= parentSibs.length) return;
    const targetParent = parentSibs[targetParentIdx];
    const oldParentId = onode.parentId;

    if (!targetParent.childrenLoaded) await ensureChildren(targetParent);

    sibs.splice(idx, 1);

    onode.parentId = targetParent.node.id;
    onode.parentKey = targetParent.key;
    fixDepths(onode, targetParent.depth + 1);
    if (direction === 'down') targetParent.children.unshift(onode);
    else targetParent.children.push(onode);
    targetParent.expanded = true;

    render();
    focusRow(onode);
    await awaitRealId(onode);
    // 新親への辺作成を await してから順序＋向き付け(apiMoveNode 経由)を永続化する。並行のままだと
    // 向き付けが辺作成より先に届き、このノードだけ向きが付かず＝リロードで位置が失われる（ドラッグ処理と同じ理由）。
    void apiToggleLink(ctx.gId, onode.node.id, oldParentId);
    await apiToggleLink(ctx.gId, onode.node.id, targetParent.node.id);
    queueReorder(targetParent.node.id); // targetParent confirmed via flushReorder
    scheduleConfirm(oldParentId);        // reconcile the parent the node left
  };

  const doIndent = async (onode: ONode, vis: ONode[], i: number) => {
    if (i === 0) return;
    const prev = vis[i - 1];
    const oldParentId = onode.parentId;

    if (!prev.childrenLoaded) await ensureChildren(prev);

    const oldSibs = getSiblings(onode);
    oldSibs.splice(oldSibs.indexOf(onode), 1);
    if (onode.parentKey === null) { const ri = rootNodeList.indexOf(onode.node); if (ri >= 0) rootNodeList.splice(ri, 1); }

    onode.parentId = prev.node.id;
    onode.parentKey = prev.key;
    fixDepths(onode, prev.depth + 1);
    prev.children.push(onode);
    prev.expanded = true;

    render();
    focusRow(onode);

    await awaitRealId(onode);
    if (oldParentId !== null) void apiToggleLink(ctx.gId, onode.node.id, oldParentId);
    // 新親への辺作成を await → queueReorder で順序＋向き付けを永続化（未実施だとリロードで位置が戻る）。
    await apiToggleLink(ctx.gId, onode.node.id, prev.node.id);
    queueReorder(prev.node.id);          // new parent confirmed via flushReorder
    if (oldParentId !== null) scheduleConfirm(oldParentId); // reconcile the parent the node left
  };

  const doDedent = async (onode: ONode) => {
    if (onode.parentId === null || onode.parentKey === null) return;
    const parent = byKey.get(onode.parentKey);
    if (!parent) return;
    const oldParentId = onode.parentId;

    parent.children.splice(parent.children.indexOf(onode), 1);

    const grandSibs = getSiblings(parent);
    const parentIdx = grandSibs.indexOf(parent);
    onode.parentId = parent.parentId;
    onode.parentKey = parent.parentKey;
    fixDepths(onode, parent.depth);
    grandSibs.splice(parentIdx + 1, 0, onode);
    // Row keys equal node ids, so no re-keying is needed; just keep rootNodeList in sync when the
    // node becomes a top-level row.
    if (parent.parentKey === null) {
      const pi = rootNodeList.indexOf(parent.node);
      rootNodeList.splice(pi < 0 ? rootNodeList.length : pi + 1, 0, onode.node);
    }

    render();
    focusRow(onode);

    await awaitRealId(onode);
    void apiToggleLink(ctx.gId, onode.node.id, oldParentId);
    // 新親（＝旧親の親）への辺作成を await → queueReorder で順序＋向き付けを永続化。
    if (onode.parentId !== null) {
      await apiToggleLink(ctx.gId, onode.node.id, onode.parentId);
      queueReorder(onode.parentId);       // new parent confirmed via flushReorder
    }
    scheduleConfirm(oldParentId);          // reconcile the parent the node left
  };

  const load = async () => {
    flushPendingReorders(); // send any queued reorder before the tree is rebuilt
    clearIndex();
    zoomStack.splice(0);
    baseDepth = 0;
    updateBreadcrumb();

    // Load the color palette (id → code), used by the link menu's color picker.
    if (ctx.colorPalette.size === 0) {
      const palette = await fetchColors(ctx.gId);
      ctx.colorPalette.clear();
      for (const { id, code } of palette) ctx.colorPalette.set(id, code);
    }

    // No cache: fetch fresh from the DO and render collapsed (root only). No expansion restore.
    // Pane-specific parent override
    if (paneParentSet) {
      if (paneParentId !== null) {
        const pid = paneParentId;
        // Exclude the pane parent itself (appears via undirected edges)
        applyRoots(await fetchChildrenFiltered(pid), pid, new Set([pid]));
      } else {
        applyRoots([], null);
      }
      return;
    }

    if (ctx.rootNodeId) {
      const rootId = ctx.rootNodeId;
      // Append the synthetic "リンクなし" entry as the last root row (parentless nodes inbox).
      const withOrphan = (nodes: ExplorerNode[]): ExplorerNode[] =>
        nodes.some(n => n.id === ORPHAN_ID) ? nodes : [...nodes, { id: ORPHAN_ID, ja: ORPHAN_LABEL }];
      applyRoots(withOrphan(await fetchChildrenFiltered(rootId)), rootId);
      return;
    }

    // Bookmarks root (no rootNodeId): always fetched fresh.
    if (ctx.state.bookmarks.size === 0) {
      const ids = await fetchBookmarks(ctx.gId);
      ctx.state.bookmarks = new Set(ids);
    }
    const lang = ctx.state.showFallback ? undefined : paneLang;
    const { nodes } = await fetchBookmarkedNodes(ctx.gId, [...ctx.state.bookmarks], lang);
    applyRoots(nodes, null);
  };

  // Ancestor NODE ids of a node visible in this pane (walk any occurrence's parentKey chain).
  const getAncestorIds = (nodeId: string): Set<string> => {
    const result = new Set<string>();
    const start = anyOccOf(nodeId);
    let current: ONode | undefined = start?.parentKey ? byKey.get(start.parentKey) : undefined;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current.key)) break; // cycle guard
      seen.add(current.key);
      result.add(current.node.id);
      current = current.parentKey ? byKey.get(current.parentKey) : undefined;
    }
    return result;
  };

  const setParent = async (nodeId: string | null, excludeIds?: Set<string>, path?: PathEntry[]) => {
    paneParentSet = true;
    paneParentId = nodeId;
    externalPath = path ?? [];
    paneSelectedId = null;
    clearIndex();
    zoomStack.splice(0);
    baseDepth = 0;
    updateBreadcrumb();
    if (nodeId !== null) {
      const nid = nodeId;
      // Exclude the pane parent itself and any specified ancestors (they appear via undirected edges)
      const excl = new Set([nid, ...(excludeIds ?? [])]);
      applyRoots(await fetchChildrenFiltered(nid), nid, excl);
    } else {
      applyRoots([], null);
    }
  };

  const getSelectedId = () => paneSelectedId;
  // Current parent whose children form this pane's rows (null = root/none). Used by the
  // multi-pane "固定" toggle to snapshot the frozen view.
  const getPaneParentId = () => (paneParentSet ? paneParentId : null);
  // Change this pane's language and re-render labels (breadcrumb + rows).
  const setLang = (l: 'en' | 'ja') => { paneLang = l; updateBreadcrumb(); render(); };

  // Reset this pane back to the graph root (source = ルート). Clears any pane-parent state
  // so load() takes the root branch — otherwise a stale paneParentId would keep showing the
  // previously-sourced node's children.
  const setSourceRoot = async () => {
    paneParentSet = false;
    paneParentId = null;
    externalPath = [];
    paneSelectedId = null;
    clearIndex();
    zoomStack.splice(0);
    baseDepth = 0;
    await load();
  };

  const search = async (query: string) => {
    if (!query) { await load(); return; }
    clearIndex(); zoomStack.splice(0); baseDepth = 0;
    updateBreadcrumb();
    const lang = ctx.state.showFallback ? undefined : paneLang;
    const { nodes } = await fetchAllNodes(ctx.gId, [], 0, lang, undefined, query, 50);
    applyRoots(nodes, null);
  };

  updateBreadcrumb(); // show "ルート" on initial render

  // Redraw every square marker — registered so the line panel can refresh participation fills
  // when the active relation (or its membership) changes.
  const rerenderAllMarkers = () => { for (const o of byKey.values()) updateExpandMarker(o); };
  ctx.relationRerender.add(rerenderAllMarkers);

  const unregister = () => {
    flushPendingReorders(true);
    for (const t of confirmTimers.values()) clearTimeout(t);
    ctx.relationRerender.delete(rerenderAllMarkers);
    window.removeEventListener('pagehide', onPageHide);
  };

  return { el, load, refresh: render, search, setParent, getAncestorIds, getNodePath, getSelectedId, getPaneParentId, setLang, setSourceRoot, beginKeyMove, acceptKeyMove, getEffectiveParentId, getNodeParentId, unregister };
}
