import type { ExplorerNode, GraphEditorContext } from './types';
import { BG, BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, primaryLabel, fallbackLabel } from './constants';
import {
  fetchChildren, fetchBookmarks, fetchBookmarkedNodes, fetchAllNodes,
  apiCreateNode, apiUpdateNode, apiDeleteNode, apiMoveNode, apiMoveBookmark, apiToggleLink,
  apiSetNodeColor, apiLinkNode, apiUnlinkNode, fetchColors,
} from './api';

// ── Occurrence model ───────────────────────────────────────────────────
// A node id can appear MULTIPLE times in one pane (multi-membership: the same node
// shown under several link panels, or reached via two paths in a DAG/diamond). So row /
// tree state is keyed by a per-OCCURRENCE key (`key`), not the node id. The key is the
// path from the pane top down to this occurrence, which is unique even when node.id
// repeats:
//   root occurrence  : `<panelTargetId|'@'>#<node.id>`   (see rootKey)
//   descendant       : `<parentKey>/<node.id>`            (see childKey)
// `node.id` still identifies the underlying graph node (used by the API / drag / caches).
type ONode = {
  node: ExplorerNode;
  /** Unique occurrence key — the path from the pane top to this occurrence. */
  key: string;
  /** Occurrence key of the parent ONode (null for a pane top-level row). */
  parentKey: string | null;
  /** Underlying parent NODE id (kept for the link API / drag, which speak node ids). */
  parentId: string | null;
  depth: number;
  expanded: boolean;
  childrenLoaded: boolean;
  children: ONode[];
};

// Root occurrence key. `panelTargetId` is the link panel this occurrence belongs to
// (Step 2); '@' is the synthetic "no panel" marker used by the single-group layout.
const rootKey = (panelTargetId: string | null, nodeId: string): string =>
  `${panelTargetId ?? '@'}#${nodeId}`;
// Descendant occurrence key: parent occurrence key + this node id.
const childKey = (parentKey: string, nodeId: string): string => `${parentKey}/${nodeId}`;

/** One breadcrumb hop: the node id and its display label, root-first. */
export type PathEntry = { id: string | null; label: string };

export type OutlinerPaneOpts = {
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

  // Breadcrumb bar (always visible)
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
      // Optimistic: insert temp node immediately (same pattern as doAddSibling). A fresh
      // node links to nothing yet → it lands in the UNCLASSIFIED panel (rootKey null panel).
      const tempId = `temp-${++ctx.tempNodeCounter}`;
      const tempNode: ExplorerNode = { id: tempId, [paneLang]: label };
      const tempKey = rootKey(null, tempId);
      const o = make(tempNode, parentId, baseDepth, tempKey, null);
      o.childrenLoaded = true;
      linkTargets.set(tempId, []);
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
        linkTargets.delete(tempId);
        rowMap.get(tempKey)?.remove(); rowMap.delete(tempKey);
        render(); // restore draft row
        return;
      }
      const typedText = rowMap.get(o.key)?.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '';
      // temp id → real id: swap link-target cache key, re-key the occurrence + row + indices.
      linkTargets.delete(tempId); linkTargets.set(nn.id, []);
      swapNodeId(o, tempId, nn.id, rootKey(null, nn.id));
      Object.assign(tempNode, nn); // copy labels/color (id already set to real by swapNodeId)
      resolveTemp(); tempReady.delete(tempId);
      const cc = ctx.childrenCache.get(parentId);
      if (cc) cc.unshift(nn); else setCachedChildren(parentId, [nn]);
      ctx.saveChildrenCache?.();
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
  // Primary index: occurrence key → ONode. (Was byId keyed by node id; multi-membership
  // means a node id can map to several occurrences, so we key by occurrence here.)
  const byKey = new Map<string, ONode>();
  // Secondary index: node id → set of its occurrence keys. Maintained alongside byKey so
  // node-level operations (rename / color / delete / property change) can reach EVERY
  // occurrence of a node, while row-level operations use a single occurrence via byKey.
  const occByNode = new Map<string, Set<string>>();
  // Occurrence key → row element. (Was keyed by node id.)
  const rowMap = new Map<string, HTMLElement>();
  // First (any) occurrence of a node id, or undefined. Convenience for node-level lookups
  // that only need one representative ONode.
  const anyOccOf = (nodeId: string): ONode | undefined => {
    const keys = occByNode.get(nodeId);
    if (!keys) return undefined;
    for (const k of keys) { const o = byKey.get(k); if (o) return o; }
    return undefined;
  };
  // All live ONodes for a node id.
  const occsOf = (nodeId: string): ONode[] => {
    const keys = occByNode.get(nodeId);
    if (!keys) return [];
    const out: ONode[] = [];
    for (const k of keys) { const o = byKey.get(k); if (o) out.push(o); }
    return out;
  };
  // Index helpers — always mutate byKey + occByNode together.
  const indexOcc = (o: ONode) => {
    byKey.set(o.key, o);
    let set = occByNode.get(o.node.id);
    if (!set) { set = new Set(); occByNode.set(o.node.id, set); }
    set.add(o.key);
  };
  const unindexOcc = (o: ONode) => {
    byKey.delete(o.key);
    const set = occByNode.get(o.node.id);
    if (set) { set.delete(o.key); if (set.size === 0) occByNode.delete(o.node.id); }
  };
  const clearIndex = () => { byKey.clear(); occByNode.clear(); };
  // Re-key an existing ONode (and its whole subtree) under a new occurrence key, keeping
  // the indices and rowMap consistent. Used when an occurrence is re-parented to a different
  // key (drag / move). Assumes node.id is unchanged.
  const rekeyOcc = (o: ONode, newKey: string) => {
    if (o.key === newKey) return;
    const row = rowMap.get(o.key);
    unindexOcc(o);
    rowMap.delete(o.key);
    o.key = newKey;
    indexOcc(o);
    if (row) rowMap.set(newKey, row);
    for (const c of o.children) rekeyOcc(c, childKey(newKey, c.node.id));
  };

  // Swap an occurrence's underlying node id (temp → real) and its occurrence key in one go,
  // keeping byKey / occByNode / rowMap consistent. The ONode's node object must NOT yet have
  // had its id mutated (we unindex under the old id first). Recurses into the subtree.
  const swapNodeId = (o: ONode, oldId: string, newId: string, newKey: string) => {
    const row = rowMap.get(o.key);
    // Unindex under the CURRENT (old) id/key.
    byKey.delete(o.key);
    const set = occByNode.get(oldId);
    if (set) { set.delete(o.key); if (set.size === 0) occByNode.delete(oldId); }
    rowMap.delete(o.key);
    // Apply the new id + key, then re-index.
    o.node.id = newId;
    o.key = newKey;
    indexOcc(o);
    if (row) { rowMap.set(newKey, row); row.dataset.nodeId = newId; }
    // Children keys embed the parent key (not the changed node id), so just re-derive them.
    for (const c of o.children) swapNodeId(c, c.node.id, c.node.id, childKey(newKey, c.node.id));
  };
  // Cache keys whose children we've fetched (or revalidated) from the backend THIS page load.
  // Entries hydrated from localStorage are stale until revalidated, so the first access of an
  // unvalidated key refetches before use — keeping reloads fast without serving stale data.
  const validated = new Set<string | null>();

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

  // ── Link panels ─────────────────────────────────────────────────────
  // Top-level rows are clustered into PANELS by the nodes they LINK TO (their neighbours via
  // fetchChildren, minus the pane parent). The same root can appear in several panels
  // (multi-membership), once per linked target.
  // Cap on how many top-level roots we prefetch link-targets for per pane (the panel-grouping
  // N+1: one fetchChildren per root). A large hub pane (100+ members) would otherwise fire
  // 100+ requests on open. Roots beyond the cap stay unclassified until grouped.
  // TODO: load more on scroll / a bulk depth-2 read.
  const LINK_PANEL_PREFETCH_LIMIT = 50;
  // Max characters shown in a (combined) panel header before truncating with an ellipsis.
  // Combined keys can list many targets, so cap the displayed text length.
  const PANEL_HEADER_MAX_CHARS = 24;

  // The synthetic panel id for roots that link to no other node ("未分類", sorts last).
  const UNCLASSIFIED = ' 未分類';

  // Per-node cache (this pane) of the link targets that define which panels a root joins.
  // Keyed by node id. Populated lazily by ensureLinkTargets before a render that needs it.
  const linkTargets = new Map<string, string[]>();
  // Labels for panel headers, keyed by target node id (filled from childrenCache / roots).
  const panelLabelCache = new Map<string, string>();

  // A panel is keyed by the WHOLE SET of a node's link targets (sorted, joined), not one
  // target. So a node with several links appears in exactly ONE combined panel (no
  // multi-membership) whose header lists all its targets. UUIDs contain no '+'/'#'/'/', so
  // the combined key stays safe as a rootKey prefix.
  const COMBO_SEP = '+';
  const comboKey = (targetIds: string[]): string => [...targetIds].sort().join(COMBO_SEP);
  const parseCombo = (key: string): string[] =>
    (key === UNCLASSIFIED || key === '' || key === '@') ? [] : key.split(COMBO_SEP);

  // Resolve a single target node's label from anything we know (the node itself or the
  // cache). Falls back to the id prefix.
  const targetLabel = (targetId: string): string => {
    const o = anyOccOf(targetId);
    if (o) return labelOf(o.node);
    const cached = panelLabelCache.get(targetId);
    if (cached) return cached;
    for (const nodes of ctx.childrenCache.values()) {
      const n = nodes.find(x => x.id === targetId);
      if (n) { const l = labelOf(n); panelLabelCache.set(targetId, l); return l; }
    }
    return targetId.slice(0, 8);
  };

  // Resolve a node's color CODE (the linked concept's own color) from anything we know —
  // any live occurrence or the children cache. Returns undefined when unknown / uncolored.
  const resolveColor = (nodeId: string): string | undefined => {
    const o = anyOccOf(nodeId);
    if (o?.node.color) return o.node.color;
    for (const nodes of ctx.childrenCache.values()) {
      const n = nodes.find(x => x.id === nodeId);
      if (n?.color) return n.color;
    }
    return undefined;
  };

  // Panel header label: '未分類' for the no-link panel, otherwise all target labels joined.
  const panelLabel = (key: string): string => {
    if (key === UNCLASSIFIED) return '未分類';
    // v1 (group-by-parent): the parent panel is labelled by the ancestor PATH to the pane
    // parent (root-first), e.g. "ルート" / "ルート / ドメイン" — we group by parent, not by a
    // node's own link targets.
    if (rootParentNodeId !== null && key === rootParentNodeId) {
      const p = selfPathPrefix();
      if (p.length) return p.map(e => e.label).join(' / ');
    }
    return parseCombo(key).map(targetLabel).join(' , ');
  };

  // The panel target ids a root belongs to: the OTHER nodes it links to, excluding the pane
  // parent (and the graph root). Empty → it joins only the UNCLASSIFIED panel.
  // TODO: bulk depth-2 read to avoid N+1 (one fetchChildren per root here).
  const ensureLinkTargets = async (rootNodeId: string) => {
    if (linkTargets.has(rootNodeId)) return;
    const parentNodeId = rootParentNodeId;
    let cached = ctx.childrenCache.get(rootNodeId);
    if (!cached) { cached = await fetchChildrenFiltered(rootNodeId); setCachedChildren(rootNodeId, cached); validated.add(rootNodeId); }
    const targets: string[] = [];
    for (const n of cached) {
      if (n.id === parentNodeId || n.id === rootNodeId) continue;
      // Skip blank-label targets: an unlabelled node is not a meaningful panel, so don't
      // form a panel for it (the root then folds into 未分類 instead of producing an empty
      // header). Covers both '' and null labels in either language.
      if (!(n.ja?.trim() || n.en?.trim())) continue;
      targets.push(n.id);
      if (!panelLabelCache.has(n.id)) panelLabelCache.set(n.id, labelOf(n));
    }
    linkTargets.set(rootNodeId, targets);
  };

  // Multi-context root (mirror/drill pane rooted at a SHARED node): each context-parent becomes
  // a panel, and a child belongs to the context(s) it links to (or all of them, if context-free).
  // Populated by computeRootContext; null for ordinary panes.
  let rootCtxParents: string[] | null = null;
  let rootCtxChildMembership: Map<string, string[]> | null = null;

  // The panel(s) a top-level node belongs to. Ordinary panes: the single pane parent (one group).
  // Multi-context panes: the context-parent(s) the node links to, so a shared node's children
  // split into per-path groups (e.g. m_user under 認証DB, m_node under グループDB).
  const panelsForNode = (nodeId: string): string[] => {
    if (rootCtxChildMembership) {
      const m = rootCtxChildMembership.get(nodeId);
      if (m && m.length) return m;
    }
    return [rootParentNodeId ?? UNCLASSIFIED];
  };

  // Stable, deterministic panel ordering: by header label, UNCLASSIFIED always last.
  const sortPanelIds = (ids: string[]): string[] =>
    [...ids].sort((a, b) => {
      if (a === UNCLASSIFIED) return 1;
      if (b === UNCLASSIFIED) return -1;
      const la = panelLabel(a), lb = panelLabel(b);
      return la < lb ? -1 : la > lb ? 1 : (a < b ? -1 : a > b ? 1 : 0);
    });

  // Panel header row (target node's label) + a divider rule under it, so each panel reads as
  // a titled section. Shown only when >1 panel is present. The rule (#4a4a4a) matches
  // buildGroupDivider; top margin separates it from the previous panel's rows.
  const buildPanelHeader = (targetId: string): HTMLElement => {
    const h = document.createElement('div');
    h.dataset.panelHeader = '1';
    h.dataset.panelTarget = targetId;
    const full = panelLabel(targetId);
    h.textContent = full.length > PANEL_HEADER_MAX_CHARS ? full.slice(0, PANEL_HEADER_MAX_CHARS) + '…' : full;
    h.style.cssText = `margin:8px 8px 3px 0;padding:0 0 3px 0;border-bottom:1px solid #4a4a4a;color:${TEXT_MID};font-size:11px;font-weight:600;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    return h;
  };

  // The raw panel-prefix segment of a root occurrence key (`<prefix>#<id>` → prefix). '@' is
  // the no-panel marker. Returns null when the key isn't a root key.
  const rootPanelPrefix = (key: string): string | null => {
    const hash = key.indexOf('#');
    return hash < 0 ? null : key.slice(0, hash);
  };
  // The panel target id a root occurrence belongs to (UNCLASSIFIED marker for the '@' prefix).
  const panelOfRoot = (root: ONode): string => {
    const p = rootPanelPrefix(root.key);
    return p == null || p === '@' ? UNCLASSIFIED : p;
  };

  // (Re)build the `roots` ONode array from `rootNodeList`, preserving the expand/loaded
  // state of any occurrence whose key still exists. Every node is emitted once per panel it
  // belongs to (multi-membership). Re-indexes byKey/occByNode for the top level only
  // (descendant occurrences are recreated lazily by ensureChildren).
  const buildRoots = () => {
    // Remember which root occurrence keys were expanded so a rebuild keeps them open.
    const prevExpanded = new Set<string>();
    for (const r of roots) if (r.expanded) prevExpanded.add(r.key);
    // Detach old root occurrences (and their subtrees) from the indices.
    const dropSubtree = (o: ONode) => { for (const c of o.children) dropSubtree(c); unindexOcc(o); };
    for (const r of roots) dropSubtree(r);

    const next: ONode[] = [];
    // Emit grouped by panel, in the SAME panel order render() uses, so the `roots` array
    // order matches DOM order (multi-select range / flatVisible rely on this). Within a
    // panel, preserve rootNodeList order.
    const byPanel = new Map<string, ExplorerNode[]>();
    for (const node of rootNodeList) {
      for (const panel of panelsForNode(node.id)) {
        let arr = byPanel.get(panel); if (!arr) { arr = []; byPanel.set(panel, arr); }
        arr.push(node);
      }
    }
    for (const panel of sortPanelIds([...byPanel.keys()])) {
      const panelId = panel === UNCLASSIFIED ? null : panel;
      for (const node of byPanel.get(panel)!) {
        const key = rootKey(panelId, node.id);
        const o = make(node, rootParentNodeId, baseDepth, key, null);
        if (prevExpanded.has(key)) o.expanded = true;
        next.push(o);
      }
    }
    roots = next;
  };

  // Set the pane's top-level node list, rebuild root occurrences, and render. Also kicks off
  // async loading of each root's link targets (N+1; see ensureLinkTargets) and re-renders once
  // they resolve so panels appear. `parentNodeId` is the underlying parent node id for the top
  // level. `excl` filters out nodes that must not appear as roots.
  const applyRoots = (nodes: ExplorerNode[], parentNodeId: string | null, excl?: Set<string>) => {
    rootParentNodeId = parentNodeId;
    baseDepth = 0;
    rootNodeList = excl ? nodes.filter(n => !excl.has(n.id)) : nodes.slice();
    buildRoots();
    render();
    if (V2_FLAT) void flatten(); else void loadLinkPanels();
  };

  // Async: load every root's link targets, then rebuild + re-render so panels surface. Guarded
  // against clobbering an in-progress edit. TODO: bulk depth-2 read to avoid N+1.
  let linkPanelsToken = 0;
  const loadLinkPanels = async () => {
    // v1 (group-by-parent): panels are keyed by the pane parent, not by per-node link targets,
    // so we no longer prefetch each root's children to build headers. This skips the old N+1
    // fetch + deferred rebuild; panels are correct on the first synchronous render.
    linkPanelsToken++;
    return;
  };

  // ── v2: flattened, parent-grouped view ─────────────────────────────────
  // Flatten the pane parent's subtree to FLAT_DEPTH levels and group every occurrence into a
  // panel keyed by its PARENT occurrence (root-relative, all-paths), so a multi-parent node
  // shows once under each parent. Each panel's header is the ancestor PATH to that parent
  // (e.g. "ルート / A / B"). This replaces the v1 single-parent header at render time.
  const V2_FLAT = true;
  const FLAT_DEPTH = 2;   // levels of children below the pane parent to flatten in
  const FLAT_MAX = 400;   // hard cap on rendered rows / expanded children (prototype guard)

  // Occurrences from the top-level root down to `occ` (inclusive), root-first.
  const occChainOcc = (occ: ONode): ONode[] => {
    const chain: ONode[] = []; const seen = new Set<string>(); let cur: ONode | undefined = occ;
    while (cur) { if (seen.has(cur.key)) break; seen.add(cur.key); chain.unshift(cur); if (cur.parentKey == null) break; cur = byKey.get(cur.parentKey); }
    return chain;
  };
  // Root-first path entries (id+label) to a group's parent: pane prefix + occurrence chain.
  const flatGroupPath = (parentOcc: ONode | null): PathEntry[] => {
    const base = selfPathPrefix();
    const chain = parentOcc ? occChainOcc(parentOcc).map(o => ({ id: o.node.id, label: labelOf(o.node) })) : [];
    const all = [...base, ...chain];
    return all.length ? all : [{ id: null, label: 'ルート' }];
  };
  // ── Flat group reordering (sibling groups → persisted node order) ───────
  // A group is identified by its PARENT occurrence key (the root group uses a sentinel and is not
  // reorderable). Dragging group X onto a SIBLING group Y (same parent occurrence) reorders the
  // two group-parents among their shared parent's children — which persists via the node-order
  // API (queueReorder). Cross-hierarchy drops are rejected: the tree shape must hold.
  const groupKeyOf = (parentOcc: ONode | null): string => parentOcc ? parentOcc.key : '__root__';
  let draggingGroupKey: string | null = null;
  // A drop is valid only onto a different SIBLING group (same parent occurrence) — used to gate
  // both the drop indicator and the drop itself, so invalid targets give no misleading feedback.
  const canDropGroup = (dragKey: string, dropKey: string): boolean => {
    const xo = byKey.get(dragKey), yo = byKey.get(dropKey);
    return !!(xo && yo && xo !== yo && xo.parentKey === yo.parentKey);
  };
  const reorderGroup = (fromKey: string, toKey: string, before: boolean) => {
    const xo = byKey.get(fromKey), yo = byKey.get(toKey);
    if (!xo || !yo || xo === yo) return;
    if (xo.parentKey !== yo.parentKey) { showToast('同じ階層（兄弟）のグループ同士でのみ並び替えできます'); return; }
    const parentOcc = xo.parentKey ? byKey.get(xo.parentKey) : null;
    const sibs = parentOcc ? parentOcc.children : roots; // sibling occurrences to reorder
    const fi = sibs.indexOf(xo); if (fi < 0) return;
    sibs.splice(fi, 1);
    const ti = sibs.indexOf(yo); if (ti < 0) { sibs.splice(fi, 0, xo); return; }
    sibs.splice(before ? ti : ti + 1, 0, xo);
    const parentNodeId = parentOcc ? parentOcc.node.id : rootParentNodeId;
    if (!parentOcc) rootNodeList = roots.map((o) => o.node); // keep the canonical root order in sync
    renderFlat();
    if (parentNodeId) queueReorder(parentNodeId); // persist the new sibling order (debounced)
  };

  // A group header styled like the pane breadcrumb bar (bcEl/updateBreadcrumb): the ancestor
  // path as ' › '-separated crumbs, plus per-group controls — copy-path, language toggle, and
  // refresh — relocated here from the pane chrome so each parent group reads as its own panel.
  const buildFlatGroupHeader = (parentOcc: ONode | null, ctxPath?: PathEntry[]): HTMLElement => {
    const h = document.createElement('div');
    h.dataset.panelHeader = '1';
    // Group header band: a single bottom BORDER divider only (no top border — the band above it
    // already supplies its own bottom line, so a top border here would double it), BG fill, flush.
    // Padding matches the pane chrome header (3px 6px) so the drag grip aligns with the pane's.
    h.style.cssText = `display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:0;padding:3px 6px;background:${BG};border-bottom:1px solid ${BORDER};font-size:12px;color:${TEXT_MID};`;

    // Drag grip — drag a group's header to reorder group sections (like the pane reorder grip).
    // Skipped for context groups (ctxPath): those are the node's parent-paths, not reorderable.
    if (!ctxPath) {
      const groupKey = groupKeyOf(parentOcc);
      const grip = document.createElement('span');
      grip.textContent = '⠿';
      grip.title = 'ドラッグでグループを並び替え';
      grip.draggable = true;
      grip.style.cssText = `flex-shrink:0;cursor:grab;color:${TEXT_DIM};font-size:13px;user-select:none;padding:0 2px;`;
      grip.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        draggingGroupKey = groupKey;
        e.dataTransfer?.setData('text/x-flat-group', groupKey);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      grip.addEventListener('dragend', () => { draggingGroupKey = null; h.style.boxShadow = ''; });
      h.appendChild(grip);
      // The header is the drop target; show a blue insertion line on the half nearest the cursor.
      h.addEventListener('dragover', (e) => {
        if (!draggingGroupKey || !canDropGroup(draggingGroupKey, groupKey)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const rect = h.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        h.style.boxShadow = before ? 'inset 0 2px 0 0 #4a9eff' : 'inset 0 -2px 0 0 #4a9eff';
      });
      h.addEventListener('dragleave', () => { h.style.boxShadow = ''; });
      h.addEventListener('drop', (e) => {
        if (!draggingGroupKey || !canDropGroup(draggingGroupKey, groupKey)) return;
        e.preventDefault();
        const rect = h.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        const from = draggingGroupKey;
        draggingGroupKey = null; h.style.boxShadow = '';
        reorderGroup(from, groupKey, before);
      });
    }

    const path = ctxPath ?? flatGroupPath(parentOcc);
    path.forEach((e, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.textContent = ' › ';
        sep.style.color = TEXT_DIM;
        h.appendChild(sep);
      }
      const span = document.createElement('span');
      span.textContent = e.label;
      span.title = e.label;
      const active = i === path.length - 1;
      span.style.cssText = `color:${active ? TEXT_HIGH : TEXT_MID};font-size:12px;padding:0 2px;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;`;
      h.appendChild(span);
    });

    const ctrls = document.createElement('span');
    ctrls.style.cssText = `margin-left:auto;display:flex;align-items:center;gap:2px;flex-shrink:0;`;
    const mkBtn = (text: string, title: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      b.style.cssText = `background:transparent;border:none;color:${TEXT_MID};cursor:pointer;font-size:12px;padding:0 4px;line-height:1;flex-shrink:0;`;
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
      return b;
    };
    // Bordered "chip" style shared by the copy and language buttons so they read as a set.
    const chip = (b: HTMLButtonElement): HTMLButtonElement => {
      b.style.border = `1px solid ${BORDER}`;
      b.style.borderRadius = '3px';
      b.style.fontSize = '10px';
      b.style.padding = '1px 4px';
      b.style.lineHeight = '1.4';
      return b;
    };
    const pathStr = path.map(p => p.label).join('/');
    ctrls.appendChild(chip(mkBtn('コピー', 'パスをコピー', () => {
      if (pathStr) void navigator.clipboard.writeText(pathStr).then(() => showToast('パスをコピーしました'));
    })));
    ctrls.appendChild(chip(mkBtn(paneLang.toUpperCase(), 'このパネルの言語を切替（JA⇄EN）', () => setLang(paneLang === 'ja' ? 'en' : 'ja'))));
    ctrls.appendChild(mkBtn('⟳', 'このパネルを再読み込み', () => { void load(); }));
    h.appendChild(ctrls);
    return h;
  };
  // Auto-expand occurrences down to `limitDepth`, loading children as needed. Bounded by FLAT_MAX
  // expanded children so a wide/deep graph can't fan out without limit.
  let flatExpandCount = 0;
  const expandToDepth = async (list: ONode[], limitDepth: number): Promise<void> => {
    for (const o of list) {
      if (o.depth >= limitDepth || flatExpandCount >= FLAT_MAX) continue;
      await ensureChildren(o);
      o.expanded = true;
      flatExpandCount += o.children.length;
      await expandToDepth(o.children, limitDepth);
    }
  };
  // Display label for a context-parent node id (resolve from any occurrence / children cache).
  const ctxLabel = (id: string): string => {
    const o = anyOccOf(id);
    if (o) return labelOf(o.node);
    for (const nodes of ctx.childrenCache.values()) { const n = nodes.find(x => x.id === id); if (n) return labelOf(n); }
    return id.slice(0, 8);
  };
  // The breadcrumb path to a context-parent group: the pane path to N with the arrival parent
  // (second-to-last) swapped for this context, e.g. [root, システム, グループDB, マスタテーブル].
  const ctxGroupPath = (ctxId: string): PathEntry[] => {
    const base = selfPathPrefix().map(e => ({ ...e }));
    if (base.length >= 2) base[base.length - 2] = { id: ctxId, label: ctxLabel(ctxId) };
    return base;
  };
  // When the pane root N is a SHARED node (reached via several sibling contexts that N links to —
  // e.g. マスタテーブル under both 認証DB and グループDB, both children of システム), compute those
  // context-parents and which context(s) each child of N belongs to. Drives the per-path groups.
  const computeRootContext = async (): Promise<void> => {
    rootCtxParents = null;
    rootCtxChildMembership = null;
    if (!paneParentSet || paneParentId === null) return;
    const N = paneParentId;
    const path = selfPathPrefix(); // [..., GP, P0, N]
    if (path.length < 3) return;
    const GP = path[path.length - 3]?.id;
    if (!GP) return;
    const [gpChildren, nNeighbors] = await Promise.all([neighborIdsOf(GP), neighborIdsOf(N)]);
    const ctxParents = [...nNeighbors].filter(x => x !== N && gpChildren.has(x));
    if (ctxParents.length <= 1) return; // single context → ordinary pane
    const ctxSets = await Promise.all(ctxParents.map(p => neighborIdsOf(p)));
    const ctxSet = new Set(ctxParents);
    const ancestors = new Set(path.map(e => e.id).filter((x): x is string => !!x));
    const membership = new Map<string, string[]>();
    for (const c of (ctx.childrenCache.get(N) ?? [])) {
      if (ctxSet.has(c.id) || c.id === N || ancestors.has(c.id)) continue; // skip context/ancestor nodes
      const belongs = ctxParents.filter((_, i) => ctxSets[i].has(c.id));
      membership.set(c.id, belongs.length ? belongs : [...ctxParents]); // context-free child → all groups
    }
    rootCtxParents = ctxParents;
    rootCtxChildMembership = membership;
  };
  // Async: compute the pane root's context (if shared), then render flat. No auto-expand: only the
  // root group(s) show initially; deeper groups appear when the user expands a node.
  const flatten = async (): Promise<void> => {
    await computeRootContext();
    if (rootCtxParents) {
      // Context-parent nodes become group HEADERS, not rows — drop them from the row list.
      const ctxSet = new Set(rootCtxParents);
      rootNodeList = rootNodeList.filter(n => !ctxSet.has(n.id));
      buildRoots();
    }
    if (listEl.contains(document.activeElement)) return; // don't clobber an active edit
    renderFlat();
  };
  // Flat render: pre-order over the occurrence tree, emitting one panel section per parent
  // (header = its ancestor path) listing that parent's child occurrences. Multi-parent nodes
  // recur once per parent. Indentation is flattened so every row in a group sits at one level.
  const renderFlat = () => {
    rowMap.clear();
    listEl.innerHTML = '';
    let count = 0; let truncated = false;
    // Emit a group's rows + closing divider (no header), flattening indentation to one level.
    const emitRows = (children: ONode[]) => {
      const saved = baseDepth;
      if (children.length) baseDepth = children[0].depth;
      for (const c of children) { if (count >= FLAT_MAX) { truncated = true; break; } listEl.appendChild(buildRow(c)); count++; }
      baseDepth = saved;
      const div = document.createElement('div');
      div.style.cssText = `border-bottom:1px solid ${BORDER};`;
      listEl.appendChild(div);
    };
    const emitGroup = (parentOcc: ONode | null, children: ONode[]) => {
      if (!children.length || truncated) return;
      listEl.appendChild(buildFlatGroupHeader(parentOcc));
      emitRows(children);
    };
    // Reveal a child group only when its parent occurrence is expanded (expansion-driven flatten):
    // initially just the root group(s); expanding a row inserts that node's group section inline.
    const dfs = (o: ONode) => { if (truncated || !o.expanded) return; if (o.children.length) { emitGroup(o, o.children); o.children.forEach(dfs); } };
    if (rootCtxParents) {
      // Multi-context pane root: one group per context-parent (the node's paths), each headed by
      // that path and listing the children that belong to it. Roots are keyed by their context.
      const byCtx = new Map<string, ONode[]>();
      for (const top of roots) { const p = panelOfRoot(top); let a = byCtx.get(p); if (!a) { a = []; byCtx.set(p, a); } a.push(top); }
      for (const ctxId of rootCtxParents) {
        if (truncated) break;
        const tops = byCtx.get(ctxId) ?? [];
        listEl.appendChild(buildFlatGroupHeader(null, ctxGroupPath(ctxId)));
        emitRows(tops);
        tops.forEach(dfs);
      }
    } else {
      // Emit groups in natural DFS pre-order (parent before its descendants). Sibling order
      // reflects the underlying node order, which group-drag reordering mutates + persists.
      emitGroup(null, roots);
      roots.forEach(dfs);
    }
    const draftParentId = paneParentSet ? paneParentId : (ctx.rootNodeId ?? null);
    draftEl.style.display = (roots.length === 0 && draftParentId !== null) ? 'flex' : 'none';
    updateSelectionHighlight();
    schedulePrefetch();
    if (paneOpts?.onContentWidthChange) scheduleWidthUpdate();
  };

  const render = () => { if (V2_FLAT) renderFlat(); else renderNested(); };

  const renderNested = () => {
    rowMap.clear();
    listEl.innerHTML = '';
    // Render a top-level node and, when expanded, its visible subtree.
    const appendSubtree = (o: ONode) => {
      listEl.appendChild(buildRow(o));
      if (o.expanded) for (const c of o.children) appendSubtree(c);
    };

    // ── Link panels: cluster roots by the node they link to. Each root is already a
    // per-panel occurrence (its key encodes the panel target); group by that, order panels
    // by header label (UNCLASSIFIED last), show a header when >1 panel. ──
    const byPanel = new Map<string, ONode[]>();
    for (const top of roots) {
      const p = panelOfRoot(top);
      let arr = byPanel.get(p); if (!arr) { arr = []; byPanel.set(p, arr); }
      arr.push(top);
    }
    const panelIds = sortPanelIds([...byPanel.keys()]);
    // v1 (group-by-parent): show the parent-path header whenever a real parent panel exists
    // (the only non-UNCLASSIFIED panel here), so the parent grouping is visible even though
    // there is a single group. Bookmark/search panes (null parent → UNCLASSIFIED) stay headerless.
    const showHeaders = panelIds.some(p => p !== UNCLASSIFIED);
    for (const pid of panelIds) {
      if (showHeaders) listEl.appendChild(buildPanelHeader(pid));
      for (const top of byPanel.get(pid)!) appendSubtree(top);
    }
    // Show draft row only when list is empty AND a valid parent is known
    const draftParentId = paneParentSet ? paneParentId : (ctx.rootNodeId ?? null);
    draftEl.style.display = (roots.length === 0 && draftParentId !== null) ? 'flex' : 'none';
    updateSelectionHighlight();
    schedulePrefetch();
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
      if (rows.length === 0) { paneOpts!.onContentWidthChange!(minW); return; }
      const firstTa = rows[0].querySelector<HTMLTextAreaElement>('textarea');
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

  // Sets childrenCache and triggers localStorage persistence
  const setCachedChildren = (key: string | null, val: ExplorerNode[]) => {
    ctx.childrenCache.set(key, val);
    ctx.saveChildrenCache?.();
  };

  // Neighbor node ids of `id` (children = undirected neighbors), fetching + caching if absent.
  const neighborIdsOf = async (id: string): Promise<Set<string>> => {
    let c = ctx.childrenCache.get(id);
    if (!c) { c = await fetchChildrenFiltered(id); setCachedChildren(id, c); }
    return new Set(c.map(n => n.id));
  };
  // v2 path-context filter for a SHARED node's children. When a node N (parent P, grandparent GP)
  // is reached through one of several "context" parents (siblings of P that N also links to — e.g.
  // 認証DB vs グループDB, both children of システム and both linked to マスタテーブル), keep only the
  // children consistent with THIS path:
  //   - drop the alternative-context nodes themselves (the other parents),
  //   - keep a child linked to P (this context),
  //   - drop a child linked to another context but not P,
  //   - keep a child linked to no context (a shared/common child).
  // Returns the input unchanged when N has no alternative context (the normal single-parent tree).
  const contextFilterNodes = async (onode: ONode, kids: ExplorerNode[]): Promise<ExplorerNode[]> => {
    const P = onode.parentId;
    if (!P) return kids;
    const gpOcc = onode.parentKey ? byKey.get(onode.parentKey) : undefined;
    const GP = gpOcc?.parentId ?? rootParentNodeId;
    if (!GP || GP === P) return kids;
    const [gpChildren, nNeighbors] = await Promise.all([neighborIdsOf(GP), neighborIdsOf(onode.node.id)]);
    const altContexts = [...nNeighbors].filter(x => x !== P && x !== onode.node.id && gpChildren.has(x));
    if (altContexts.length === 0) return kids;
    const altSet = new Set(altContexts);
    const [pNeighbors, ...altNeighborSets] = await Promise.all([
      neighborIdsOf(P), ...altContexts.map(q => neighborIdsOf(q)),
    ]);
    return kids.filter(c => {
      if (altSet.has(c.id)) return false;                 // an alternative-context node itself
      if (pNeighbors.has(c.id)) return true;              // belongs to this (P) context
      return !altNeighborSets.some(s => s.has(c.id));     // linked to another context → drop
    });
  };

  const ensureChildren = async (onode: ONode) => {
    if (onode.childrenLoaded) return;
    const id = onode.node.id;
    let cached = ctx.childrenCache.get(id);
    // Refetch when missing OR when only a stale (unvalidated) localStorage entry exists.
    // ensureChildren runs before the subtree is rendered, so awaiting fresh data here keeps
    // expanded children in sync with the backend without any in-place rebuild.
    if (!cached || !validated.has(id)) {
      cached = await fetchChildrenFiltered(id);
      setCachedChildren(id, cached);
      validated.add(id);
    }
    const excl = ancestorIds(onode); excl.add(onode.node.id);
    let kids = cached.filter(c => !excl.has(c.id));
    // v2: drop children that belong to a sibling path-context (e.g. show 認証DB's tables under
    // 認証DB › マスタテーブル, not グループDB's). No-op for normal (single-context) trees.
    if (V2_FLAT) kids = await contextFilterNodes(onode, kids);
    // Child occurrence keys embed THIS occurrence's key, so the same child node reached via
    // two parent occurrences gets two distinct keys (multi-membership / diamond-safe).
    onode.children = kids
      .map(c => make(c, onode.node.id, onode.depth + 1, childKey(onode.key, c.id), onode.key));
    onode.childrenLoaded = true;
  };

  // Warm childrenCache for visible-but-unexpanded nodes serially
  let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePrefetch = () => {
    if (prefetchTimer) clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
      prefetchTimer = null;
      const queue = flatVisible().filter(o => !o.childrenLoaded && !ctx.childrenCache.has(o.node.id));
      let i = 0;
      const next = () => {
        if (i >= queue.length) return;
        const o = queue[i++];
        if (!o.childrenLoaded && !ctx.childrenCache.has(o.node.id)) void ensureChildren(o).then(next);
        else next();
      };
      next();
    }, 150);
  };

  const updateExpandMarker = (onode: ONode) => {
    const row = rowMap.get(onode.key);
    if (!row) return;
    const m = row.querySelector<HTMLElement>('[data-expand-marker]');
    if (!m) return;
    const hasChildren = onode.childrenLoaded
      ? onode.children.length > 0
      : (ctx.childrenCache.get(onode.node.id)?.length ?? 1) > 0;
    // Color the square from the node's LINKED concept nodes' own colors: 1 color → solid,
    // 2+ → split the square left/right with the first two colors (3rd onward omitted), so a
    // node linked to several colored concepts is distinguishable.
    const linkColors = (linkTargets.get(onode.node.id) ?? [])
      .map(tid => resolveColor(tid))
      .filter((c): c is string => c != null);
    m.style.border = 'none';
    if (linkColors.length >= 2) {
      m.style.background = `linear-gradient(90deg, ${linkColors[0]} 0 50%, ${linkColors[1]} 50% 100%)`;
    } else if (linkColors.length === 1) {
      m.style.background = linkColors[0];
    } else {
      m.style.background = hasChildren && !onode.expanded ? TEXT_MID : TEXT_DIM;
    }
    // Triangle expand button (right side)
    const tri = row.querySelector<HTMLElement>('[data-expand-triangle]');
    if (tri) {
      tri.textContent = onode.expanded ? '▾' : '▸';
      tri.style.opacity = hasChildren ? '1' : '0';
      tri.style.pointerEvents = hasChildren ? 'auto' : 'none';
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
    schedulePrefetch();
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
    if (V2_FLAT) {
      // Flat mode: expansion reveals/hides the node's group SECTION, so re-render the flat view
      // rather than nesting rows in place.
      onode.expanded = next;
      renderFlat();
      if (paneOpts?.onContentWidthChange) scheduleWidthUpdate();
      focusRow(onode);
      return;
    }
    if (next) expandInDom(onode); else collapseInDom(onode);
    // expand/collapse mutate the DOM directly (no full render), so re-measure the pane
    // width here — otherwise collapsing long rows leaves the column stuck at its wide size.
    if (paneOpts?.onContentWidthChange) scheduleWidthUpdate();
    focusRow(onode);
  };

  // ── Breadcrumb ───────────────────────────────────────────────────────
  const updateBreadcrumb = () => {
    // Flat (v2) mode: every group renders its own breadcrumb, so the pane-level breadcrumb bar
    // is redundant — hide it.
    if (V2_FLAT) { bcEl.style.display = 'none'; return; }
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
        const cc = ctx.childrenCache.get(o.parentId);
        if (cc) { const ci = cc.findIndex(n => n.id === node.id); if (ci >= 0) cc.splice(ci, 1); }
      }
      linkTargets.delete(node.id);
    }
    ctx.saveChildrenCache?.();
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
    btnWrap.addEventListener('click', (e) => { e.stopPropagation(); showPropertyMenu(onode, e.clientX, e.clientY); });
    btnWrap.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      const lbl = primaryLabel(onode.node, paneLang) ?? fallbackLabel(onode.node, paneLang) ?? '';
      void navigator.clipboard.writeText(`[${onode.node.id}]${lbl}`).then(() => showToast('コピーしました'));
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
        const cc = ctx.childrenCache.get(onode.parentId);
        const cn = cc?.find(n => n.id === onode.node.id);
        if (cn) { if (paneLang === 'en') cn.en = newVal; else cn.ja = newVal; }
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
        if (isMultiSelect()) doDeleteMulti();
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

    // Triangle expand button (right side)
    const triBtn = document.createElement('button');
    triBtn.dataset.expandTriangle = '1';
    triBtn.textContent = '▸';
    triBtn.style.cssText = `flex-shrink:0;background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:10px;padding:0 4px;opacity:0;pointer-events:none;line-height:1;`;
    triBtn.addEventListener('click', (e) => { e.stopPropagation(); void toggleExpand(onode); });

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

        // ── Case 1: top-level→top-level = panel relink + reorder. The node stays top-level
        // (same pane parent), only its panel membership changes. Rebuild from rootNodeList +
        // linkTargets so multi-membership stays consistent. ──
        if (topLevelDrop && movers.every(m => m.parentKey === null)) {
          const destPanel = panelOfRoot(onode); // combined key (or UNCLASSIFIED)
          // Drop onto a panel = make each mover's link set equal that panel's target set.
          for (const m of movers) {
            const fromPanel = panelOfRoot(m);
            if (fromPanel !== destPanel) void relinkPanel(m.node.id, fromPanel, destPanel);
          }
          // Move mover nodes adjacent to the target in rootNodeList (panel is a display group;
          // ordering is the canonical list).
          const moverNodes = movers.map(m => m.node);
          const moverSet = new Set(moverNodes);
          rootNodeList = rootNodeList.filter(n => !moverSet.has(n));
          let ti = rootNodeList.indexOf(onode.node);
          if (ti < 0) ti = rootNodeList.length - 1;
          rootNodeList.splice(zone === 'before' ? ti : ti + 1, 0, ...moverNodes);
          buildRoots();
          ctx.saveChildrenCache?.();
          render();
          const back = anyOccOf(moverNodes[0].id); if (back) focusRow(back);
          if (rootParentNodeId !== null) {
            await Promise.all(movers.map(m => awaitRealId(m)));
            void apiMoveNode(ctx.gId, moverNodes[0].id, rootParentNodeId, 'down', rootNodeList.map(n => n.id));
          }
          return;
        }

        // ── Case 2: reparent (child zone, or a child being lifted to top level). ──
        // Capture each mover's pre-move parent NODE id (keyed by the mover ONode itself, which
        // is stable across the re-keying below) for the link-toggle pass.
        const oldParents = new Map<ONode, string | null>(movers.map(o => [o, o.parentId]));
        for (const mover of movers) {
          const sibs = getSiblings(mover);
          const idx = sibs.indexOf(mover);
          if (idx >= 0) sibs.splice(idx, 1);
          if (mover.parentKey === null) { const ri = rootNodeList.indexOf(mover.node); if (ri >= 0) rootNodeList.splice(ri, 1); }
          const cc = ctx.childrenCache.get(mover.parentId);
          if (cc) { const ci = cc.findIndex(n => n.id === mover.node.id); if (ci >= 0) cc.splice(ci, 1); }
        }
        // Recompute insert index after removals (removals above the target shift it left).
        const at = insertAtFor();
        for (let i = 0; i < movers.length; i++) {
          const mover = movers[i];
          mover.parentId = newParentId;
          fixDepths(mover, childDepth);
          newSibs.splice(at + i, 0, mover);
          // Re-derive the occurrence key for the new location, then re-index the subtree.
          if (topLevelDrop) {
            const panelId = panelOfRoot(onode) === UNCLASSIFIED ? null : panelOfRoot(onode);
            mover.parentKey = null;
            rekeyOcc(mover, rootKey(panelId, mover.node.id));
            rootNodeList.splice(Math.min(at + i, rootNodeList.length), 0, mover.node);
            linkTargets.delete(mover.node.id);
          } else {
            mover.parentKey = onode.key; // child zone → onode is the new parent occurrence
            rekeyOcc(mover, childKey(onode.key, mover.node.id));
          }
        }
        const affectedParents = new Set<string | null>([...oldParents.values(), newParentId]);
        for (const pid of affectedParents) { if (pid !== null) ctx.childrenCache.delete(pid); }
        ctx.saveChildrenCache?.();
        render();

        await Promise.all(movers.map(m => awaitRealId(m)));
        for (const mover of movers) {
          const oldPid = oldParents.get(mover) ?? null;
          if (oldPid !== newParentId) {
            if (oldPid !== null) void apiToggleLink(ctx.gId, mover.node.id, oldPid);
            if (newParentId !== null) void apiToggleLink(ctx.gId, mover.node.id, newParentId);
          }
        }
        if (newParentId !== null) {
          void apiMoveNode(ctx.gId, movers[0].node.id, newParentId, 'down', newSibs.map(s => s.node.id));
        }
      } else {
        // ── Cross-pane move (movers came from another pane) ──
        await moveAcrossPanes(pd, newParentId, newSibs, insertAtFor(), childDepth);
      }
    };

    row.insertBefore(triBtn, btnWrap);
    row.appendChild(ta);
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
      if (intoRoots) { rootNodeList.splice(Math.min(insertAt + i, rootNodeList.length), 0, inserted[i].node); linkTargets.delete(inserted[i].node.id); }
    }

    // Invalidate caches for source + target parents so other views refetch fresh data.
    const affected = new Set<string | null>([newParentId]);
    for (const m of movers) affected.add(m.oldParentId);
    for (const pid of affected) { if (pid !== null) ctx.childrenCache.delete(pid); }
    ctx.saveChildrenCache?.();
    render();

    // Remove the nodes from the source pane (re-renders it).
    pd.detachFromSource(movers.map(m => m.node));

    // Resolve any temp ids before hitting the API.
    await pd.awaitRealIds();
    for (const m of movers) {
      const oldPid = m.oldParentId;
      if (oldPid !== newParentId) {
        if (oldPid !== null) void apiToggleLink(ctx.gId, m.node.id, oldPid);
        if (newParentId !== null) void apiToggleLink(ctx.gId, m.node.id, newParentId);
      }
    }
    if (newParentId !== null) {
      void apiMoveNode(ctx.gId, movers[0].node.id, newParentId, 'down', newSibs.map(s => s.node.id));
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

  // ── Property menu (right-click on expand marker) ─────────────────────

  // ── Node link + color menu (click on expand marker) ──────────────────

  // Set a concept node's color CODE locally (childrenCache + every live occurrence) and
  // refresh the markers/text of every row, so a color change to a linked concept shows up
  // everywhere it is referenced. Persisted separately by the caller via apiSetNodeColor.
  const setConceptColor = (nodeId: string, code: string | null) => {
    for (const o of occsOf(nodeId)) o.node.color = code ?? undefined;
    ctx.childrenCache.forEach(nodes => { for (const n of nodes) if (n.id === nodeId) n.color = code ?? undefined; });
    ctx.saveChildrenCache?.();
    // The color of a linked concept feeds every referrer's marker → refresh all markers.
    rowMap.forEach((_, k) => { const o = byKey.get(k); if (o) updateExpandMarker(o); });
    // The concept node's own rows show the color as their text color too.
    for (const o of occsOf(nodeId)) {
      const ta = rowMap.get(o.key)?.querySelector<HTMLTextAreaElement>('textarea');
      if (ta) ta.style.color = code ?? TEXT_HIGH;
    }
  };

  // Link-panel relink: drop onto a panel = make the node's link set
  // EQUAL that panel's target set. fromKey/toKey are combined panel keys (or UNCLASSIFIED).
  // We diff the sets: drop links only in `from`, add links only in `to`. apiToggleLink toggles,
  // and the drag invariant (node IS linked to its from-set, NOT to the added to-targets) makes
  // plain toggles reach the right final state. Updates the local linkTargets cache too.
  const relinkPanel = async (nodeId: string, fromKey: string, toKey: string) => {
    const fromSet = new Set(parseCombo(fromKey));
    const toSet = new Set(parseCombo(toKey));
    const toRemove = [...fromSet].filter(t => !toSet.has(t));
    const toAdd = [...toSet].filter(t => !fromSet.has(t));
    linkTargets.set(nodeId, [...toSet]);
    for (const t of toRemove) await apiToggleLink(ctx.gId, nodeId, t); // unlink
    for (const t of toAdd) await apiToggleLink(ctx.gId, nodeId, t);    // link
  };

  // Color picker popover for a CONCEPT NODE (the linked node). Applies the chosen palette
  // code to the node and persists via apiSetNodeColor (null clears). `onChanged` refreshes
  // the caller UI (the link menu) after the change.
  const showColorPickerFor = (nodeId: string, anchorEl: HTMLElement, onChanged: () => void) => {
    document.querySelector('[data-color-picker]')?.remove();
    const picker = document.createElement('div');
    picker.dataset.colorPicker = '1';
    picker.style.cssText = `position:fixed;z-index:101;background:hsl(240,14%,12%);border:1px solid ${BORDER};border-radius:6px;padding:6px;display:grid;grid-template-columns:repeat(6,1fr);gap:4px;box-shadow:0 4px 12px rgba(0,0,0,.5);`;
    const ar = anchorEl.getBoundingClientRect();
    picker.style.left = `${ar.left}px`;
    picker.style.top = `${ar.bottom + 4}px`;

    const current = resolveColor(nodeId); // current color CODE
    const apply = (code: string | null) => {
      setConceptColor(nodeId, code);
      void apiSetNodeColor(ctx.gId, nodeId, code);
      picker.remove();
      onChanged();
    };
    const noneBtn = document.createElement('button');
    noneBtn.title = '色なし'; noneBtn.textContent = '×';
    noneBtn.style.cssText = `width:20px;height:20px;border-radius:4px;border:1.5px solid ${BORDER};background:transparent;cursor:pointer;grid-column:span 2;font-size:10px;color:${TEXT_DIM};`;
    noneBtn.addEventListener('click', () => apply(null));
    picker.appendChild(noneBtn);
    for (const [id, code] of ctx.colorPalette) {
      const btn = document.createElement('button');
      btn.title = id;
      btn.style.cssText = `width:20px;height:20px;border-radius:4px;border:${current === code ? `2px solid ${TEXT_HIGH}` : 'none'};background:${code};cursor:pointer;`;
      btn.addEventListener('click', () => apply(code));
      picker.appendChild(btn);
    }
    document.body.appendChild(picker);
    const closePicker = (e: MouseEvent) => {
      if (!picker.contains(e.target as Node)) { picker.remove(); document.removeEventListener('click', closePicker, true); }
    };
    setTimeout(() => document.addEventListener('click', closePicker, true), 0);
  };

  // Click on a row's left square opens this menu: shows the node's LINKED concept nodes as
  // chips (× unlinks, clicking the label assigns a color to that concept), plus a node SEARCH
  // that links the chosen (or a newly-created) node to this one.
  const showPropertyMenu = (onode: ONode, x: number, y: number) => {
    document.querySelector('[data-prop-menu]')?.remove();
    document.querySelector('[data-color-picker]')?.remove();

    const menu = document.createElement('div');
    menu.dataset.propMenu = '1';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:100;width:260px;background:hsl(240,14%,9%);border:1px solid ${BORDER};border-radius:6px;padding:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.4);`;

    const sid = onode.node.id;

    // Refresh this node's marker + panels after a link change.
    const refreshAfterLink = () => {
      for (const o of occsOf(sid)) updateExpandMarker(o);
      buildRoots();
      render();
    };

    // Link an existing node to this one (idempotent). Optimistically updates linkTargets +
    // childrenCache so chips/markers/panels reflect it at once.
    const linkExisting = async (target: ExplorerNode) => {
      if (target.id === sid) return;
      const cur = linkTargets.get(sid) ?? [];
      if (!cur.includes(target.id)) { cur.push(target.id); linkTargets.set(sid, cur); }
      if (!panelLabelCache.has(target.id)) panelLabelCache.set(target.id, labelOf(target));
      const cc = ctx.childrenCache.get(sid);
      if (cc && !cc.find(n => n.id === target.id)) { cc.push(target); ctx.saveChildrenCache?.(); }
      refreshAfterLink();
      await apiLinkNode(ctx.gId, sid, target.id);
    };

    // Create a brand-new node (no parent) and link it.
    const createAndLink = async (label: string) => {
      const nn = await apiCreateNode(ctx.gId, null, paneLang, label);
      if (nn) await linkExisting(nn);
    };

    const rebuild = () => {
      menu.innerHTML = '';

      // ── Linked concept chips: the node's link targets (pane parent already excluded by
      // ensureLinkTargets). × unlinks; clicking the label assigns a color to that concept. ──
      const tagsEl = document.createElement('div');
      tagsEl.style.cssText = `display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;min-height:4px;`;
      for (const tid of (linkTargets.get(sid) ?? [])) {
        const col = resolveColor(tid) ?? TEXT_DIM;
        const tag = document.createElement('span');
        tag.style.cssText = `display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;background:${col};color:#fff;font-size:12px;font-weight:500;`;
        const namePart = document.createElement('span');
        namePart.textContent = targetLabel(tid);
        namePart.style.cursor = 'pointer';
        namePart.addEventListener('click', (e) => { e.stopPropagation(); showColorPickerFor(tid, tag, rebuild); });
        const xBtn = document.createElement('button');
        xBtn.textContent = '×';
        xBtn.style.cssText = `background:transparent;border:none;color:#fff;opacity:.7;cursor:pointer;padding:0 0 0 3px;font-size:11px;line-height:1;`;
        xBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          // Unlink the edge between this node and the target.
          linkTargets.set(sid, (linkTargets.get(sid) ?? []).filter(t => t !== tid));
          refreshAfterLink();
          rebuild();
          await apiUnlinkNode(ctx.gId, sid, tid);
        });
        tag.append(namePart, xBtn);
        tagsEl.appendChild(tag);
      }
      menu.appendChild(tagsEl);

      // ── Node search input: links the chosen node; Enter with no exact match creates one. ──
      const searchIn = document.createElement('input');
      searchIn.placeholder = '';
      searchIn.style.cssText = `width:100%;box-sizing:border-box;background:transparent;border:1px solid ${BORDER};border-radius:3px;padding:4px 6px;color:${TEXT_HIGH};font-size:12px;outline:none;font-family:inherit;margin-bottom:4px;`;
      menu.appendChild(searchIn);

      const divider = document.createElement('div');
      divider.style.cssText = `border-top:1px solid ${BORDER};margin:2px 0 4px;`;
      menu.appendChild(divider);

      const listContainer = document.createElement('div');
      listContainer.style.cssText = `max-height:220px;overflow-y:auto;`;
      menu.appendChild(listContainer);

      let resultNodes: ExplorerNode[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      const runSearch = async () => {
        const q = searchIn.value.trim();
        listContainer.innerHTML = '';
        resultNodes = [];
        if (!q) return;
        const lang = ctx.state.showFallback ? undefined : paneLang;
        const { nodes } = await fetchAllNodes(ctx.gId, [], 0, lang, undefined, q, 20);
        const linked = new Set(linkTargets.get(sid) ?? []);
        resultNodes = nodes.filter(n => n.id !== sid && !linked.has(n.id));
        for (const n of resultNodes) {
          const lbl = (primaryLabel(n, paneLang) ?? fallbackLabel(n, paneLang)) || n.id.slice(0, 8);
          const item = document.createElement('div');
          item.textContent = lbl;
          item.style.cssText = `padding:4px 6px;cursor:pointer;font-size:13px;color:${TEXT_MID};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:3px;`;
          item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,.05)'; });
          item.addEventListener('mouseleave', () => { item.style.background = ''; });
          item.addEventListener('click', () => { void linkExisting(n); searchIn.value = ''; rebuild(); });
          listContainer.appendChild(item);
        }
      };
      searchIn.addEventListener('input', () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void runSearch(), 200); });
      searchIn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const val = searchIn.value.trim();
        if (!val) return;
        // Exact label match among current results → link it; otherwise create a new node.
        const exact = resultNodes.find(n => (primaryLabel(n, paneLang) ?? fallbackLabel(n, paneLang)) === val);
        if (exact) { void linkExisting(exact); } else { void createAndLink(val); }
        searchIn.value = '';
        rebuild();
      });
      searchIn.focus();
    };

    rebuild();
    // Chips need this node's link targets; load them (lazy for non-root rows) then refill.
    void ensureLinkTargets(sid).then(() => { if (document.body.contains(menu)) rebuild(); });
    document.body.appendChild(menu);
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth) menu.style.left = `${window.innerWidth - r.width - 8}px`;
      if (r.bottom > window.innerHeight) menu.style.top = `${y - r.height}px`;
    });
    const onOutside = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!menu.contains(t) && !t?.closest('[data-color-picker]'))
        { menu.remove(); document.removeEventListener('mousedown', onOutside); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.querySelector('[data-color-picker]')?.remove();
        menu.remove(); document.removeEventListener('keydown', onKey);
      }
    };
    setTimeout(() => { document.addEventListener('mousedown', onOutside); document.addEventListener('keydown', onKey); }, 0);
  };

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

      // Replace this occurrence's underlying node with the found node, then re-key it
      // (the occurrence key embeds the node id). unindex under old id, swap, re-index.
      const prefix = rootPanelPrefix(onode.key); // preserve which panel this root sat in
      unindexOcc(onode);
      rowMap.delete(onode.key);
      onode.node = node;
      onode.key = wasRoot
        ? rootKey(prefix === '@' || prefix == null ? null : prefix, node.id)
        : childKey(onode.parentKey!, node.id);
      indexOcc(onode);
      row.dataset.nodeId = node.id;
      row.dataset.occKey = onode.key;
      rowMap.set(onode.key, row);
      if (wasRoot) { const ri = rootNodeList.indexOf(oldNode); if (ri >= 0) rootNodeList[ri] = node; }

      // Update textarea to show found node's label
      ta.value = (primaryLabel(node, paneLang) ?? fallbackLabel(node, paneLang)) || '';

      // Update childrenCache entry
      const cc = ctx.childrenCache.get(onode.parentId);
      if (cc) { const ci = cc.findIndex(x => x.id === oldId); if (ci >= 0) cc[ci] = node; }

      // Delete old placeholder node; link found node to parent
      void apiDeleteNode(ctx.gId, oldId);
      const edgeTarget = onode.parentId ?? ctx.rootNodeId;
      if (edgeTarget) void apiToggleLink(ctx.gId, node.id, edgeTarget);

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

  const doDeleteMulti = () => {
    const sel = getSelectedONodes();
    if (sel.length === 0) return;
    // Delete acts on NODES → every occurrence of each selected node id is removed.
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
    clearSelection();
    for (const nodeId of selNodeIds) {
      for (const n of occsOf(nodeId)) {
        if (n.expanded) collapseInDom(n);
        rowMap.get(n.key)?.remove(); rowMap.delete(n.key);
        const sibs = getSiblings(n);
        const idx = sibs.indexOf(n); if (idx !== -1) sibs.splice(idx, 1);
        if (n.parentKey === null) { const ri = rootNodeList.indexOf(n.node); if (ri >= 0) rootNodeList.splice(ri, 1); }
        unindexOcc(n);
        const cc = ctx.childrenCache.get(n.parentId);
        if (cc) { const ci = cc.findIndex(x => x.id === nodeId); if (ci >= 0) cc.splice(ci, 1); }
      }
      linkTargets.delete(nodeId);
      void apiDeleteNode(ctx.gId, nodeId);
    }
    const target = targetKey ? byKey.get(targetKey) : undefined;
    if (target) focusRow(target);
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
      ctx.saveChildrenCache?.();
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
      const cc = ctx.childrenCache.get(parentId);
      if (cc) { const order = new Map(sibs.map((n, i) => [n.node.id, i])); cc.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)); }
      updateSelectionHighlight();
      if (parentId !== null) queueReorder(parentId);
      ctx.saveChildrenCache?.();
      return;
    }
    if (direction === 'down' && maxIdx < sibs.length - 1) {
      const displaced = sibs[maxIdx + 1];
      sibs.splice(maxIdx + 1, 1); sibs.splice(minIdx, 0, displaced);
      const displacedRows = visibleRowGroup(displaced);
      const firstGroupRow = rowMap.get(sel[0].key);
      if (!firstGroupRow) return;
      for (const r of displacedRows) listEl.insertBefore(r, firstGroupRow);
      const cc = ctx.childrenCache.get(parentId);
      if (cc) { const order = new Map(sibs.map((n, i) => [n.node.id, i])); cc.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)); }
      updateSelectionHighlight();
      if (parentId !== null) queueReorder(parentId);
      ctx.saveChildrenCache?.();
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
    const oldCc = ctx.childrenCache.get(oldParentId);
    const selIds = new Set(sel.map(n => n.node.id));
    if (oldCc) oldCc.splice(0, oldCc.length, ...oldCc.filter(x => !selIds.has(x.id)));

    // Re-parent, fix depths, and re-key each occurrence under the new parent occurrence.
    const newDepth = targetParent.depth + 1;
    for (const n of sel) {
      n.parentId = targetParent.node.id;
      n.parentKey = targetParent.key;
      fixDepths(n, newDepth);
      rekeyOcc(n, childKey(targetParent.key, n.node.id));
    }

    if (direction === 'down') targetParent.children.unshift(...sel);
    else targetParent.children.push(...sel);
    targetParent.expanded = true;
    ctx.childrenCache.delete(targetParent.node.id);

    render();
    if (sel[0]) focusRow(sel[0]);

    await Promise.all(sel.map(n => awaitRealId(n)));
    for (const n of sel) {
      void apiToggleLink(ctx.gId, n.node.id, oldParentId);
      void apiToggleLink(ctx.gId, n.node.id, targetParent.node.id);
    }
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
    // New sibling shares onode's parent occurrence (and, for a root, its panel).
    const tempKey = isRoot
      ? rootKey(panelOfRoot(onode) === UNCLASSIFIED ? null : panelOfRoot(onode), tempId)
      : childKey(onode.parentKey!, tempId);
    const no = make(tempNode, onode.parentId, onode.depth, tempKey, onode.parentKey);
    no.childrenLoaded = true;
    linkTargets.set(tempId, []);
    sibs.splice(before ? idx : idx + 1, 0, no);
    if (isRoot) { const ai = rootNodeList.indexOf(onode.node); rootNodeList.splice(ai < 0 ? rootNodeList.length : (before ? ai : ai + 1), 0, tempNode); }

    const cleanupTemp = () => {
      sibs.splice(sibs.indexOf(no), 1); unindexOcc(no); linkTargets.delete(tempId);
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
    // temp id → real id: swap the occurrence id + key + indices + row, and the cache key.
    linkTargets.delete(tempId); linkTargets.set(nn.id, []);
    const newKey = isRoot
      ? rootKey(panelOfRoot(onode) === UNCLASSIFIED ? null : panelOfRoot(onode), nn.id)
      : childKey(onode.parentKey!, nn.id);
    swapNodeId(no, tempId, nn.id, newKey);
    Object.assign(tempNode, nn); // copy labels/color (id already real via swapNodeId)
    resolveTemp();
    tempReady.delete(tempId);

    const cc = ctx.childrenCache.get(onode.parentId);
    if (cc) { const ci = cc.findIndex(n => n.id === onode.node.id); if (ci >= 0) cc.splice(before ? ci : ci + 1, 0, nn); }

    // If inserting before the first node, the backend appended it to chain end → move to front
    if (before && !prevSibNode && onode.parentId !== null) {
      void apiMoveNode(ctx.gId, nn.id, onode.parentId, 'up', siblingIdsForParent(onode.parentId));
    }

    ctx.saveChildrenCache?.();
    // Persist later edits, but skip when the label already matches what we created with (paste path).
    if (typedText.trim() && typedText.trim() !== initialText.trim()) void apiUpdateNode(ctx.gId, nn.id, paneLang, typedText);
    return no;
  };

  const doDelete = (onode: ONode, _visIdx: number, _vis: ONode[]) => {
    const nodeId = onode.node.id;
    // Pick the focus target from the VISIBLE (DOM) order by occurrence key — capture the DOM
    // neighbour (row above, else below) of THIS occurrence while it's still in the list.
    const rowEl = rowMap.get(onode.key);
    let targetKey: string | null = null;
    if (rowEl) {
      const rows = [...listEl.querySelectorAll<HTMLElement>('[data-occ-key]')];
      const di = rows.indexOf(rowEl);
      targetKey = (rows[di - 1] ?? rows[di + 1])?.dataset.occKey ?? null;
    }
    // Delete is node-level → remove every occurrence of this node id.
    for (const o of occsOf(nodeId)) {
      if (o.expanded) collapseInDom(o);
      rowMap.get(o.key)?.remove(); rowMap.delete(o.key);
      const sibs = getSiblings(o);
      const si = sibs.indexOf(o); if (si >= 0) sibs.splice(si, 1);
      if (o.parentKey === null) { const ri = rootNodeList.indexOf(o.node); if (ri >= 0) rootNodeList.splice(ri, 1); }
      unindexOcc(o);
      const cc = ctx.childrenCache.get(o.parentId);
      if (cc) { const ci = cc.findIndex(n => n.id === nodeId); if (ci >= 0) cc.splice(ci, 1); }
    }
    linkTargets.delete(nodeId);
    const target = targetKey ? byKey.get(targetKey) : undefined;
    if (target) focusRow(target);
    void apiDeleteNode(ctx.gId, nodeId);
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
      ctx.saveChildrenCache?.();
      return;
    }

    const sibs = getSiblings(onode);
    const idx = sibs.indexOf(onode);
    const newIdx = idx + (direction === 'up' ? -1 : 1);

    if (newIdx >= 0 && newIdx < sibs.length) {
      const neighbor = sibs[newIdx];
      sibs.splice(idx, 1); sibs.splice(newIdx, 0, onode);
      const cc = ctx.childrenCache.get(onode.parentId);
      if (cc) { const ci = cc.findIndex(n => n.id === onode.node.id); if (ci >= 0) { cc.splice(ci, 1); cc.splice(newIdx, 0, onode.node); } }
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
      ctx.saveChildrenCache?.();
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
    const oldCc = ctx.childrenCache.get(oldParentId);
    if (oldCc) { const ci = oldCc.findIndex(n => n.id === onode.node.id); if (ci >= 0) oldCc.splice(ci, 1); }

    onode.parentId = targetParent.node.id;
    onode.parentKey = targetParent.key;
    fixDepths(onode, targetParent.depth + 1);
    rekeyOcc(onode, childKey(targetParent.key, onode.node.id));
    if (direction === 'down') targetParent.children.unshift(onode);
    else targetParent.children.push(onode);
    targetParent.expanded = true;
    ctx.childrenCache.delete(targetParent.node.id);

    render();
    focusRow(onode);
    await awaitRealId(onode);
    void apiToggleLink(ctx.gId, onode.node.id, oldParentId);
    void apiToggleLink(ctx.gId, onode.node.id, targetParent.node.id);
  };

  const doIndent = async (onode: ONode, vis: ONode[], i: number) => {
    if (i === 0) return;
    const prev = vis[i - 1];
    const oldParentId = onode.parentId;

    if (!prev.childrenLoaded) await ensureChildren(prev);

    const oldSibs = getSiblings(onode);
    oldSibs.splice(oldSibs.indexOf(onode), 1);
    if (onode.parentKey === null) { const ri = rootNodeList.indexOf(onode.node); if (ri >= 0) rootNodeList.splice(ri, 1); }
    const oldCc = ctx.childrenCache.get(oldParentId);
    if (oldCc) { const ci = oldCc.findIndex(n => n.id === onode.node.id); if (ci >= 0) oldCc.splice(ci, 1); }

    onode.parentId = prev.node.id;
    onode.parentKey = prev.key;
    fixDepths(onode, prev.depth + 1);
    rekeyOcc(onode, childKey(prev.key, onode.node.id));
    prev.children.push(onode);
    prev.expanded = true;
    ctx.childrenCache.delete(prev.node.id);

    render();
    focusRow(onode);

    await awaitRealId(onode);
    if (oldParentId !== null) void apiToggleLink(ctx.gId, onode.node.id, oldParentId);
    void apiToggleLink(ctx.gId, onode.node.id, prev.node.id);
  };

  const doDedent = async (onode: ONode) => {
    if (onode.parentId === null || onode.parentKey === null) return;
    const parent = byKey.get(onode.parentKey);
    if (!parent) return;
    const oldParentId = onode.parentId;

    parent.children.splice(parent.children.indexOf(onode), 1);
    ctx.childrenCache.delete(oldParentId);

    const grandSibs = getSiblings(parent);
    const parentIdx = grandSibs.indexOf(parent);
    onode.parentId = parent.parentId;
    onode.parentKey = parent.parentKey;
    fixDepths(onode, parent.depth);
    grandSibs.splice(parentIdx + 1, 0, onode);
    // Re-key under the new parent occurrence (or as a root, preserving the parent's panel).
    if (parent.parentKey === null) {
      const newKey = rootKey(panelOfRoot(parent) === UNCLASSIFIED ? null : panelOfRoot(parent), onode.node.id);
      rekeyOcc(onode, newKey);
      const pi = rootNodeList.indexOf(parent.node);
      rootNodeList.splice(pi < 0 ? rootNodeList.length : pi + 1, 0, onode.node);
    } else {
      rekeyOcc(onode, childKey(parent.parentKey, onode.node.id));
    }
    if (onode.parentId !== null) ctx.childrenCache.delete(onode.parentId);

    render();
    focusRow(onode);

    await awaitRealId(onode);
    void apiToggleLink(ctx.gId, onode.node.id, oldParentId);
    if (onode.parentId !== null) void apiToggleLink(ctx.gId, onode.node.id, onode.parentId);
  };

  // Shallow structural comparison of two child lists — detects whether a revalidation
  // fetch returned anything that affects rendering (order, labels, color).
  const childrenDiffer = (a: ExplorerNode[], b: ExplorerNode[]): boolean => {
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x.id !== y.id || (x.en ?? '') !== (y.en ?? '') || (x.ja ?? '') !== (y.ja ?? '') || (x.color ?? '') !== (y.color ?? '')) return true;
    }
    return false;
  };

  // Stale-while-revalidate: after the caller paints from the (possibly stale) localStorage
  // cache for an instant reload, fetch fresh children from the backend and re-render if the
  // data changed. Without this, edits persisted to the backend appear to "revert" on reload
  // because the editor renders from a cache that is never revalidated. Bails on a likely
  // transient fetch error (empty result replacing a non-empty cache) to avoid blanking the
  // tree, and skips the re-render while the user is mid-edit so focus isn't clobbered.
  const revalidate = async (
    cacheKey: string | null,
    fetchId: string,
    painted: ExplorerNode[] | undefined,
    apply: (nodes: ExplorerNode[]) => void,
  ) => {
    const fresh = await fetchChildrenFiltered(fetchId);
    if (fresh.length === 0 && painted && painted.length > 0) return; // suspected transient error
    setCachedChildren(cacheKey, fresh);
    validated.add(cacheKey);
    if (painted && !childrenDiffer(painted, fresh)) return; // nothing changed since the paint
    if (listEl.contains(document.activeElement)) return;     // don't clobber an active edit
    clearIndex();
    apply(fresh);
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

    // Pane-specific parent override
    if (paneParentSet) {
      if (paneParentId !== null) {
        const pid = paneParentId;
        // Exclude the pane parent itself (appears via undirected edges)
        const excl = new Set([pid]);
        const apply = (nodes: ExplorerNode[]) => applyRoots(nodes, pid, excl);
        const cached = ctx.childrenCache.get(pid);
        if (cached) apply(cached);
        await revalidate(pid, pid, cached, apply);
      } else {
        applyRoots([], null);
      }
      return;
    }

    if (ctx.rootNodeId) {
      const rootId = ctx.rootNodeId;
      const apply = (nodes: ExplorerNode[]) => applyRoots(nodes, rootId);
      // Use same cache key (null) as column view so both views share the same root node list
      const cached = ctx.childrenCache.get(null);
      if (cached) apply(cached);
      // Stale-while-revalidate against the backend so edits persisted since the cache was
      // written are reflected on reload (rather than reverting to the cached snapshot).
      await revalidate(null, rootId, cached, apply);
      return;
    }

    // Bookmarks root (no rootNodeId): always fetched fresh, no persistent cache.
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
      const apply = (nodes: ExplorerNode[]) => applyRoots(nodes, nid, excl);
      const cached = ctx.childrenCache.get(nid);
      if (cached) apply(cached);
      await revalidate(nid, nid, cached, apply);
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

  const unregister = () => {
    flushPendingReorders(true);
    window.removeEventListener('pagehide', onPageHide);
  };

  return { el, load, refresh: render, search, setParent, getAncestorIds, getNodePath, getSelectedId, getPaneParentId, setLang, setSourceRoot, beginKeyMove, acceptKeyMove, getEffectiveParentId, getNodeParentId, unregister };
}
