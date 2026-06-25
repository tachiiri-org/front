import type { ExplorerNode, GraphEditorContext } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, primaryLabel, fallbackLabel } from './constants';
import {
  fetchChildren, fetchBookmarks, fetchBookmarkedNodes, fetchAllNodes,
  apiCreateNode, apiUpdateNode, apiDeleteNode, apiMoveNode, apiMoveBookmark, apiToggleLink,
  apiSetProperty, apiRemoveProperty, apiDeletePropertyKey,
  fetchColors, fetchPropertyColors, apiSetPropertyColor, apiRemovePropertyColor,
  fetchPropertyOrder, apiSavePropertyOrder, fetchAllPropertyKeys,
} from './api';

type ONode = {
  node: ExplorerNode;
  parentId: string | null;
  depth: number;
  expanded: boolean;
  childrenLoaded: boolean;
  children: ONode[];
};

/** One breadcrumb hop: the node id and its display label, root-first. */
export type PathEntry = { id: string | null; label: string };

export type OutlinerPaneOpts = {
  /** If set, this pane shows children of this node (null = empty until setParent called) */
  paneParentId?: string | null;
  /** Breadcrumb path (root-first) to paneParentId, for panel-sourced panes */
  panePath?: PathEntry[];
  /** Only show nodes that have ALL of these property keys */
  paneFilterKeys?: Set<string>;
  /** If true, sort nodes by property keyOrder ascending (stable sort) */
  paneSortByProps?: boolean;
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
  filterBtn: HTMLElement;
  load: () => Promise<void>;
  refresh: () => void;
  search: (query: string) => Promise<void>;
  setParent: (nodeId: string | null, excludeIds?: Set<string>, path?: PathEntry[]) => Promise<void>;
  getAncestorIds: (nodeId: string) => Set<string>;
  getNodePath: (nodeId: string) => PathEntry[];
  getSelectedId: () => string | null;
  getPaneParentId: () => string | null;
  setPaneFilterKeys: (keys: Set<string>) => void;
  setPaneSortByProps: (enabled: boolean) => void;
  setSourceRoot: () => Promise<void>;
  applyPropertySort: () => Promise<void>;
  beginKeyMove: (nodeId: string) => boolean;
  acceptKeyMove: () => Promise<void>;
  getEffectiveParentId: () => string | null;
  getNodeParentId: (nodeId: string) => string | null | undefined;
  openKeyMenu: (opts: {
    anchor: HTMLElement;
    mode: 'pane-filter';
    isActive: (key: string) => boolean;
    onToggle: (key: string) => void;
  }) => void;
  unregister: () => void;
} {
  // Outer wrapper (returned as el)
  const el = document.createElement('div');
  el.style.cssText = `flex:1;display:flex;flex-direction:column;overflow:hidden;`;

  // Breadcrumb bar (always visible)
  const bcEl = document.createElement('div');
  bcEl.style.cssText = `display:flex;flex-shrink:0;align-items:center;gap:2px;flex-wrap:wrap;padding:4px 8px 4px 10px;border-bottom:1px solid ${BORDER};font-size:12px;`;
  el.appendChild(bcEl);

  // Active property key filters
  const filterKeys = new Set<string>();

  // Ordered list of all known property keys (persisted to backend)
  let keyOrder: string[] = [];

  const addKeyToOrder = (key: string, persist = false) => {
    if (!keyOrder.includes(key)) {
      keyOrder.push(key);
      if (persist) void apiSavePropertyOrder(ctx.gId, keyOrder);
    }
    ctx.allPropKeys.add(key);
  };

  // filterBtn is placed in topBar by index.ts (returned as part of createOutlinerView result)
  const filterBtn = document.createElement('button');
  filterBtn.textContent = 'フィルタ';

  const updateFilterBtn = () => {
    const n = filterKeys.size;
    filterBtn.textContent = n > 0 ? `フィルタ (${n})` : 'フィルタ';
  };

  filterBtn.addEventListener('click', (e) => {
    const r = filterBtn.getBoundingClientRect();
    showFilterMenu(r.left, r.bottom + 4);
    e.stopPropagation();
  });

  const showFilterMenu = (x: number, y: number) => {
    document.querySelector('[data-filter-menu]')?.remove();
    document.querySelector('[data-key-ctx-menu]')?.remove();
    document.querySelector('[data-color-picker]')?.remove();
    const menu = document.createElement('div');
    menu.dataset.filterMenu = '1';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:100;width:260px;background:hsl(240,14%,9%);border:1px solid ${BORDER};border-radius:6px;padding:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.4);`;

    const rebuildFilterMenu = () => {
      menu.innerHTML = '';

      // Active filter tags
      const tagsEl = document.createElement('div');
      tagsEl.style.cssText = `display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;min-height:4px;`;
      for (const key of keyOrder) {
        if (!filterKeys.has(key)) continue;
        const col = ctx.allPropColors.get(key)?.code ?? TEXT_DIM;
        const tag = document.createElement('span');
        tag.style.cssText = `display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;background:${col};color:#fff;font-size:12px;font-weight:500;`;
        const namePart = document.createElement('span'); namePart.textContent = key;
        const xBtn = document.createElement('button');
        xBtn.textContent = '×';
        xBtn.style.cssText = `background:transparent;border:none;color:#fff;opacity:.7;cursor:pointer;padding:0 0 0 3px;font-size:11px;line-height:1;`;
        xBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          filterKeys.delete(key);
          updateFilterBtn();
          render();
          rebuildFilterMenu();
        });
        tag.append(namePart, xBtn);
        tagsEl.appendChild(tag);
      }
      menu.appendChild(tagsEl);

      const searchIn = document.createElement('input');
      searchIn.placeholder = '';
      searchIn.style.cssText = `width:100%;box-sizing:border-box;background:transparent;border:1px solid ${BORDER};border-radius:3px;padding:4px 6px;color:${TEXT_HIGH};font-size:12px;outline:none;font-family:inherit;margin-bottom:4px;`;
      menu.appendChild(searchIn);

      const divider = document.createElement('div');
      divider.style.cssText = `border-top:1px solid ${BORDER};margin:2px 0 4px;`;
      menu.appendChild(divider);

      const listContainer = document.createElement('div');
      listContainer.style.cssText = `max-height:220px;overflow-y:auto;`;
      searchIn.addEventListener('input', () => buildKeyList(listContainer, 'filter', null, searchIn, rebuildFilterMenu));
      searchIn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const val = searchIn.value.trim();
        if (!val) return;
        addKeyToOrder(val, true);
        if (!filterKeys.has(val)) { filterKeys.add(val); updateFilterBtn(); render(); }
        searchIn.value = '';
        rebuildFilterMenu();
      });
      buildKeyList(listContainer, 'filter', null, searchIn, rebuildFilterMenu);
      menu.appendChild(listContainer);
    };

    rebuildFilterMenu();
    document.body.appendChild(menu);
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth) menu.style.left = `${window.innerWidth - r.width - 8}px`;
      if (r.bottom > window.innerHeight) menu.style.top = `${y - r.height}px`;
    });
    const close = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!menu.contains(t) && !t?.closest('[data-key-ctx-menu]') && !t?.closest('[data-color-picker]'))
        { menu.remove(); document.removeEventListener('click', close, true); }
    };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  };

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
      // Optimistic: insert temp node immediately (same pattern as doAddSibling)
      const tempId = `temp-${++ctx.tempNodeCounter}`;
      const tempNode: ExplorerNode = { id: tempId, [ctx.state.lang]: label };
      const o = make(tempNode, parentId, 0);
      o.childrenLoaded = true;
      roots.unshift(o);
      let resolveTemp!: () => void;
      tempReady.set(tempId, new Promise<void>(res => { resolveTemp = res; }));
      render(); // hides draft row, shows temp node at top
      focusRow(o);
      const nn = await apiCreateNode(ctx.gId, parentId, ctx.state.lang, label);
      if (!nn) {
        resolveTemp(); tempReady.delete(tempId);
        roots.splice(roots.indexOf(o), 1); byId.delete(tempId);
        rowMap.get(tempId)?.remove(); rowMap.delete(tempId);
        render(); // restore draft row
        return;
      }
      const typedText = rowMap.get(tempId)?.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '';
      byId.delete(tempId); byId.set(nn.id, o);
      const tempRowEl = rowMap.get(tempId);
      rowMap.delete(tempId); if (tempRowEl) { rowMap.set(nn.id, tempRowEl); tempRowEl.dataset.nodeId = nn.id; }
      Object.assign(tempNode, nn);
      resolveTemp(); tempReady.delete(tempId);
      const cc = ctx.childrenCache.get(parentId);
      if (cc) cc.unshift(nn); else setCachedChildren(parentId, [nn]);
      ctx.saveChildrenCache?.();
      if (typedText.trim() && typedText.trim() !== label) void apiUpdateNode(ctx.gId, nn.id, ctx.state.lang, typedText.trim());
      // Move to front in backend (was appended to chain end)
      void apiMoveNode(ctx.gId, nn.id, parentId, 'up', roots.map(r => r.node.id));
    }
  });
  draftEl.append(draftSpacer, draftBtnWrap, draftTa);
  el.appendChild(draftEl);

  // Scrollable list
  const listEl = document.createElement('div');
  listEl.dataset.outlinerList = '1';
  listEl.style.cssText = `flex:1;overflow-y:auto;overflow-x:hidden;padding:4px 0 4px 10px;`;
  el.appendChild(listEl);

  let roots: ONode[] = [];
  let baseDepth = 0; // depth of current root level (for relative indent display)
  const byId = new Map<string, ONode>();
  const rowMap = new Map<string, HTMLElement>();
  // Cache keys whose children we've fetched (or revalidated) from the backend THIS page load.
  // Entries hydrated from localStorage are stale until revalidated, so the first access of an
  // unvalidated key refetches before use — keeping reloads fast without serving stale data.
  const validated = new Set<string | null>();

  // Pane state
  let paneParentSet = paneOpts?.paneParentId !== undefined;
  let paneParentId: string | null = paneOpts?.paneParentId ?? null;
  let paneSelectedId: string | null = null;
  let paneFilterKeys: Set<string> = paneOpts?.paneFilterKeys ?? new Set();
  let paneSortByProps: boolean = paneOpts?.paneSortByProps ?? false;
  // Breadcrumb path (root-first, inclusive of paneParentId) for panel-sourced panes
  let externalPath: PathEntry[] = paneOpts?.panePath ?? [];

  const labelOf = (node: ExplorerNode): string =>
    primaryLabel(node, ctx.state.lang) ?? fallbackLabel(node, ctx.state.lang) ?? node.id.slice(0, 8);

  // Path (root-first, inclusive) to the node whose children form this pane's top-level rows.
  const selfPathPrefix = (): PathEntry[] => {
    const base: PathEntry[] = paneParentSet
      ? [...externalPath]
      : (ctx.rootNodeId ? [{ id: ctx.rootNodeId, label: 'ルート' }] : []);
    for (const z of zoomStack) base.push({ id: z.node.id, label: labelOf(z.node) });
    return base;
  };

  // Full breadcrumb path (root-first, inclusive) to a node currently visible in this pane.
  const getNodePath = (nodeId: string): PathEntry[] => {
    const rootParentId = zoomStack.length
      ? zoomStack[zoomStack.length - 1].node.id
      : (paneParentSet ? paneParentId : ctx.rootNodeId);
    const chain: PathEntry[] = [];
    let cur = byId.get(nodeId);
    while (cur) {
      chain.unshift({ id: cur.node.id, label: labelOf(cur.node) });
      if (cur.parentId === rootParentId || cur.parentId == null) break;
      cur = byId.get(cur.parentId);
    }
    return [...selfPathPrefix(), ...chain];
  };

  const setPaneSelected = (nodeId: string | null) => {
    paneSelectedId = nodeId;
    paneOpts?.onNodeSelect?.(nodeId);
  };

  // Zoom stack: ONodes we've zoomed into (innermost last)
  const zoomStack: ONode[] = [];

  // Multi-select state: anchor (fixed end) and cur (moving end)
  let selAnchorId: string | null = null;
  let selCurId: string | null = null;

  const make = (node: ExplorerNode, parentId: string | null, depth: number): ONode => {
    const o: ONode = { node, parentId, depth, expanded: false, childrenLoaded: false, children: [] };
    byId.set(node.id, o);
    return o;
  };

  const ancestorIds = (onode: ONode): Set<string> => {
    const ids = new Set<string>();
    let cur: ONode | undefined = onode;
    while (cur?.parentId != null) { ids.add(cur.parentId); cur = byId.get(cur.parentId); }
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

  // Full rebuild — for load / zoom / delete / indent
  // True when the node passes the active per-pane filter (no filter → always true).
  const passesPaneFilter = (onode: ONode): boolean => {
    if (paneFilterKeys.size === 0) return true;
    const props = ctx.propStore.get(onode.node.id) ?? {};
    return [...paneFilterKeys].some(k => k in props);
  };

  // Stable multi-key comparator by property keyOrder: nodes with earlier keys come first,
  // within the same key compare values asc, nodes without any property go last.
  const compareByProps = (a: ONode, b: ONode): number => {
    const masterKeys = [...new Set([...keyOrder, ...ctx.allPropKeys])];
    const pa = ctx.propStore.get(a.node.id) ?? {};
    const pb = ctx.propStore.get(b.node.id) ?? {};
    for (const k of masterKeys) {
      const hasA = k in pa, hasB = k in pb;
      if (hasA !== hasB) return hasA ? -1 : 1;
      if (hasA) {
        const cmp = (pa[k] || '').localeCompare(pb[k] || '', undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  };

  const render = () => {
    rowMap.clear();
    listEl.innerHTML = '';
    let base: ONode[];
    if (filterKeys.size > 0) {
      const matched: ONode[] = [];
      byId.forEach(o => {
        const props = ctx.propStore.get(o.node.id) ?? {};
        if ([...filterKeys].some(k => k in props)) matched.push(o);
      });
      base = matched;
    } else {
      base = flatVisible();
    }
    // Apply per-pane filter
    const toRender = paneFilterKeys.size > 0 ? base.filter(passesPaneFilter) : base;
    let finalRender = toRender;
    if (paneSortByProps) finalRender = [...toRender].sort(compareByProps);
    for (const o of finalRender) listEl.appendChild(buildRow(o));
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
      const rows = listEl.querySelectorAll<HTMLElement>('[data-node-id]');
      if (rows.length === 0) { paneOpts!.onContentWidthChange!(180); return; }
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
      const minW = Math.max(280, Math.round(window.innerWidth * 0.20));
      const maxCap = Math.round(window.innerWidth * 0.40);
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
    rowMap.get(onode.node.id)?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  };

  const getSelectedONodes = (): ONode[] => {
    if (!selAnchorId) return [];
    const vis = flatVisible();
    const ai = vis.findIndex(n => n.node.id === selAnchorId);
    if (ai === -1) return [];
    if (!selCurId || selCurId === selAnchorId) return [vis[ai]].filter(Boolean);
    const ci = vis.findIndex(n => n.node.id === selCurId);
    if (ci === -1) return [vis[ai]].filter(Boolean);
    return vis.slice(Math.min(ai, ci), Math.max(ai, ci) + 1);
  };

  const isMultiSelect = () => getSelectedONodes().length > 1;

  const updateSelectionHighlight = () => {
    const sel = getSelectedONodes();
    const ids = sel.length > 1 ? new Set(sel.map(n => n.node.id)) : new Set<string>();
    rowMap.forEach((row, id) => {
      row.style.backgroundColor = ids.has(id) ? 'rgba(99,102,241,0.12)' : '';
    });
  };

  const clearSelection = () => { selAnchorId = null; selCurId = null; updateSelectionHighlight(); };

  const lastDescRow = (onode: ONode): HTMLElement | undefined => {
    if (onode.expanded && onode.children.length > 0)
      return lastDescRow(onode.children[onode.children.length - 1]);
    return rowMap.get(onode.node.id);
  };

  const visibleRowGroup = (onode: ONode): HTMLElement[] => {
    const rows: HTMLElement[] = [];
    const walk = (o: ONode) => {
      const r = rowMap.get(o.node.id); if (r) rows.push(r);
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
    seedPropStore(cached);
    const excl = ancestorIds(onode); excl.add(onode.node.id);
    onode.children = cached.filter(c => !excl.has(c.id)).map(c => make(c, onode.node.id, onode.depth + 1));
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
    const row = rowMap.get(onode.node.id);
    if (!row) return;
    const m = row.querySelector<HTMLElement>('[data-expand-marker]');
    if (!m) return;
    const hasChildren = onode.childrenLoaded
      ? onode.children.length > 0
      : (ctx.childrenCache.get(onode.node.id)?.length ?? 1) > 0;
    // Show assigned property colors: 1 color → solid, 2+ → split the square left/right with
    // the first two colors (3rd onward omitted), so multi-property nodes are distinguishable.
    const nodeProps = ctx.propStore.get(onode.node.id) ?? {};
    const propColors = Object.keys(nodeProps)
      .map(k => ctx.allPropColors.get(k)?.code)
      .filter((c): c is string => c != null);
    m.style.border = 'none';
    if (propColors.length >= 2) {
      m.style.background = `linear-gradient(90deg, ${propColors[0]} 0 50%, ${propColors[1]} 50% 100%)`;
    } else if (propColors.length === 1) {
      m.style.background = propColors[0];
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
    let anchor: HTMLElement | undefined = rowMap.get(onode.node.id);
    if (!anchor) return;
    let anchorEl: HTMLElement = anchor;
    const insertSubtree = (list: ONode[]) => {
      for (const child of list) {
        // Honour the active pane filter for expanded children too (matches render());
        // a filtered-out parent is skipped but its passing descendants still surface.
        if (passesPaneFilter(child)) {
          const row = buildRow(child);
          anchorEl.insertAdjacentElement('afterend', row);
          anchorEl = row;
        }
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
        rowMap.get(child.node.id)?.remove(); rowMap.delete(child.node.id);
        if (child.expanded) removeSubtree(child.children);
      }
    };
    removeSubtree(onode.children);
  };

  const expandingSet = new Set<string>();
  const toggleExpand = async (onode: ONode, forceExpand?: boolean) => {
    const next = forceExpand !== undefined ? forceExpand : !onode.expanded;
    if (next === onode.expanded) { focusRow(onode); return; }
    if (next && expandingSet.has(onode.node.id)) return;
    if (next && !onode.childrenLoaded) {
      expandingSet.add(onode.node.id);
      await ensureChildren(onode);
      expandingSet.delete(onode.node.id);
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
    roots = onode.children;
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
      baseDepth = top.depth + 1;
      render();
      updateBreadcrumb();
    }
  };

  const doZoomOut = async () => {
    if (zoomStack.length === 0) return;
    const prev = zoomStack[zoomStack.length - 1];
    await doZoomTo(zoomStack.length - 1);
    // Focus the node we just came from (now visible in parent view)
    if (byId.has(prev.node.id)) focusRow(prev);
  };

  // ── Row builder ──────────────────────────────────────────────────────
  // Active drag state for node reordering / reparenting
  let dragNodeId: string | null = null;
  let dragParentId: string | null | undefined = undefined;
  let dragMultiIds: string[] | null = null; // non-null when dragging a multi-selection
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

  // Remove the given nodes from THIS pane's local tree + caches and re-render.
  // Called on the source pane after a cross-pane drop moves nodes out of it.
  const detachNodes = (nodes: ExplorerNode[]) => {
    for (const node of nodes) {
      const o = byId.get(node.id);
      if (!o) continue;
      const sibs = getSiblings(o);
      const idx = sibs.indexOf(o);
      if (idx >= 0) sibs.splice(idx, 1);
      byId.delete(node.id);
      const cc = ctx.childrenCache.get(o.parentId);
      if (cc) { const ci = cc.findIndex(n => n.id === node.id); if (ci >= 0) cc.splice(ci, 1); }
    }
    ctx.saveChildrenCache?.();
    render();
  };

  // Drop target guard shared by dragover + drop: true when `onode` is one of the
  // dragged nodes, or (same-pane) sits inside a dragged node's subtree.
  const dropBlockedBy = (onode: ONode, pd: NonNullable<typeof ctx.paneDrag>): boolean => {
    if (pd.nodeIds.includes(onode.node.id)) return true;
    for (const id of pd.nodeIds) {
      const o = byId.get(id);
      if (o && isInSubtree(onode, o)) return true;
    }
    return false;
  };

  const buildRow = (onode: ONode): HTMLElement => {
    const row = document.createElement('div');
    row.dataset.nodeId = onode.node.id;
    row.style.cssText = `display:flex;align-items:center;padding:0;border:2px solid transparent;border-radius:3px;`;
    rowMap.set(onode.node.id, row);

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
      const lbl = primaryLabel(onode.node, ctx.state.lang) ?? fallbackLabel(onode.node, ctx.state.lang) ?? '';
      void navigator.clipboard.writeText(`[${onode.node.id}]${lbl}`).then(() => showToast('コピーしました'));
    });
    row.appendChild(btnWrap);

    const label = primaryLabel(onode.node, ctx.state.lang) ?? fallbackLabel(onode.node, ctx.state.lang);
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

    ta.addEventListener('blur', () => {
      const old = primaryLabel(onode.node, ctx.state.lang) ?? fallbackLabel(onode.node, ctx.state.lang);
      const newVal = ta.value;
      if (newVal !== old) {
        if (ctx.state.lang === 'en') onode.node.en = newVal; else onode.node.ja = newVal;
        const cc = ctx.childrenCache.get(onode.parentId);
        const cn = cc?.find(n => n.id === onode.node.id);
        if (cn) { if (ctx.state.lang === 'en') cn.en = newVal; else cn.ja = newVal; }
        void apiUpdateNode(ctx.gId, onode.node.id, ctx.state.lang, newVal);
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
        if (!selAnchorId) selAnchorId = onode.node.id;
        const prevId = tAs[tIdx - 1].closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
        if (prevId) { selCurId = prevId; updateSelectionHighlight(); }
        tAs[tIdx - 1].focus();
        return;
      }
      if (e.key === 'ArrowDown' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const tAs = [...listEl.querySelectorAll<HTMLTextAreaElement>('textarea')];
        const tIdx = tAs.indexOf(ta);
        if (tIdx >= tAs.length - 1) return;
        if (!selAnchorId) selAnchorId = onode.node.id;
        const nextId = tAs[tIdx + 1].closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
        if (nextId) { selCurId = nextId; updateSelectionHighlight(); }
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
      dragParentId = onode.parentId;
      const sel = getSelectedONodes();
      dragMultiIds = (sel.length > 1 && sel.some(o => o.node.id === onode.node.id))
        ? sel.map(o => o.node.id) : null;
      // Populate the shared cross-pane drag state so a different pane can resolve the
      // dragged node(s) on drop. Movers carry their node + parent-at-dragstart.
      const dragONodes: ONode[] = dragMultiIds
        ? dragMultiIds.map(id => byId.get(id)).filter((o): o is ONode => !!o)
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
      dragParentId = undefined;
      dragMultiIds = null;
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
        const movers: ONode[] = (dragMultiIds
          ? dragMultiIds.map(id => byId.get(id)).filter((o): o is ONode => !!o)
          : [byId.get(pd.nodeIds[0])].filter((o): o is ONode => !!o))
          .filter(o => o.node.id !== onode.node.id && !isInSubtree(onode, o));
        if (movers.length === 0) return;

        const oldParents = new Map(movers.map(o => [o.node.id, o.parentId]));
        for (const mover of movers) {
          const sibs = getSiblings(mover);
          const idx = sibs.indexOf(mover);
          if (idx >= 0) sibs.splice(idx, 1);
          const cc = ctx.childrenCache.get(mover.parentId);
          if (cc) { const ci = cc.findIndex(n => n.id === mover.node.id); if (ci >= 0) cc.splice(ci, 1); }
        }
        // Recompute insert index after removals (removals above the target shift it left).
        const at = insertAtFor();
        for (let i = 0; i < movers.length; i++) {
          movers[i].parentId = newParentId;
          fixDepths(movers[i], childDepth);
          newSibs.splice(at + i, 0, movers[i]);
        }
        const affectedParents = new Set([...oldParents.values(), newParentId]);
        for (const pid of affectedParents) { if (pid !== null) ctx.childrenCache.delete(pid); }
        ctx.saveChildrenCache?.();
        render();

        await Promise.all(movers.map(m => awaitRealId(m)));
        for (const mover of movers) {
          const oldPid = oldParents.get(mover.node.id) ?? null;
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

  const getSiblings = (onode: ONode): ONode[] =>
    onode.parentId === null ? roots : (byId.get(onode.parentId)?.children ?? roots);

  const fixDepths = (o: ONode, d: number) => {
    o.depth = d;
    o.children.forEach(c => fixDepths(c, d + 1));
  };

  const isInSubtree = (target: ONode, root: ONode): boolean => {
    if (target.node.id === root.node.id) return true;
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
    const movers = pd.movers;
    if (movers.length === 0) return;

    // Guard against duplicate ids: if a mover is already a sibling at the destination
    // (e.g. both panes show the same parent), remove the existing entry first so the node
    // appears exactly once. Otherwise the order sent to apiMoveNode would contain a
    // duplicate id and corrupt the sibling chain.
    for (const m of movers) {
      const ex = newSibs.findIndex(s => s.node.id === m.node.id);
      if (ex >= 0) { newSibs.splice(ex, 1); if (ex < insertAt) insertAt--; }
    }

    const inserted: ONode[] = [];
    for (const m of movers) {
      byId.delete(m.node.id); // drop any stale ONode for the same id, then rebuild
      inserted.push(make(m.node, newParentId, targetDepth));
    }
    seedPropStore(movers.map(m => m.node));
    for (let i = 0; i < inserted.length; i++) newSibs.splice(insertAt + i, 0, inserted[i]);

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
    const o = byId.get(nodeId);
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
    byId.get(nodeId)?.parentId;

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
    const o = byId.get(movedId);
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

  // Update propStore/allPropKeys and sync to all ExplorerNode instances in childrenCache
  const syncPropChange = (nodeId: string, updater: (props: Record<string, string>) => void) => {
    const props = ctx.propStore.get(nodeId) ?? {};
    updater(props);
    if (Object.keys(props).length > 0) ctx.propStore.set(nodeId, props);
    else ctx.propStore.delete(nodeId);
    for (const k of Object.keys(props)) addKeyToOrder(k);
    // Also sync to ExplorerNode instances already in memory
    ctx.childrenCache.forEach(nodes => {
      for (const n of nodes) { if (n.id === nodeId) n.properties = { ...props }; }
    });
    const o = byId.get(nodeId);
    if (o) o.node.properties = { ...props };
    // Broadcast to all registered outliner views with the changed nodeId
    ctx.propChangeHooks.forEach(h => h(nodeId));
  };

  // Shared color picker popover (callback called after color change to refresh caller UI)
  const showColorPickerFor = (key: string, anchorEl: HTMLElement, onChanged: () => void) => {
    document.querySelector('[data-color-picker]')?.remove();
    const picker = document.createElement('div');
    picker.dataset.colorPicker = '1';
    picker.style.cssText = `position:fixed;z-index:101;background:hsl(240,14%,12%);border:1px solid ${BORDER};border-radius:6px;padding:6px;display:grid;grid-template-columns:repeat(6,1fr);gap:4px;box-shadow:0 4px 12px rgba(0,0,0,.5);`;
    const ar = anchorEl.getBoundingClientRect();
    picker.style.left = `${ar.left}px`;
    picker.style.top = `${ar.bottom + 4}px`;

    const current = ctx.allPropColors.get(key)?.colorId;
    const noneBtn = document.createElement('button');
    noneBtn.title = '色なし'; noneBtn.textContent = '×';
    noneBtn.style.cssText = `width:20px;height:20px;border-radius:4px;border:1.5px solid ${BORDER};background:transparent;cursor:pointer;grid-column:span 2;font-size:10px;color:${TEXT_DIM};`;
    noneBtn.addEventListener('click', () => {
      ctx.allPropColors.delete(key);
      void apiRemovePropertyColor(ctx.gId, key);
      picker.remove();
      onChanged();
      rowMap.forEach((_, id) => { const o = byId.get(id); if (o) updateExpandMarker(o); });
    });
    picker.appendChild(noneBtn);
    for (const [id, code] of ctx.colorPalette) {
      const btn = document.createElement('button');
      btn.title = id;
      btn.style.cssText = `width:20px;height:20px;border-radius:4px;border:${current === id ? `2px solid ${TEXT_HIGH}` : 'none'};background:${code};cursor:pointer;`;
      btn.addEventListener('click', () => {
        ctx.allPropColors.set(key, { colorId: id, code });
        void apiSetPropertyColor(ctx.gId, key, id);
        picker.remove();
        onChanged();
        rowMap.forEach((_, nid) => { const o = byId.get(nid); if (o) updateExpandMarker(o); });
      });
      picker.appendChild(btn);
    }
    document.body.appendChild(picker);
    const closePicker = (e: MouseEvent) => {
      if (!picker.contains(e.target as Node)) { picker.remove(); document.removeEventListener('click', closePicker, true); }
    };
    setTimeout(() => document.addEventListener('click', closePicker, true), 0);
  };

  // Delete a property key globally from all nodes + memory
  const deleteKey = (key: string, onDone: () => void) => {
    keyOrder = keyOrder.filter(k => k !== key);
    ctx.allPropKeys.delete(key);
    ctx.allPropColors.delete(key);
    filterKeys.delete(key);
    ctx.propStore.forEach((props, nid) => {
      if (key in props) {
        delete props[key];
        const o = byId.get(nid);
        if (o) { o.node.properties = { ...props }; updateExpandMarker(o); }
      }
    });
    ctx.childrenCache.forEach(nodes => {
      for (const n of nodes) { if (n.properties && key in n.properties) delete n.properties[key]; }
    });
    void apiDeletePropertyKey(ctx.gId, key);
    void apiSavePropertyOrder(ctx.gId, keyOrder);
    updateFilterBtn();
    render();
    onDone();
  };

  // ⋯ context menu per key: inline color palette + delete
  const showKeyContextMenu = (key: string, anchor: HTMLElement, onDone: () => void) => {
    document.querySelector('[data-key-ctx-menu]')?.remove();
    const m = document.createElement('div');
    m.dataset.keyCtxMenu = '1';
    m.style.cssText = `position:fixed;z-index:102;background:hsl(240,14%,9%);border:1px solid ${BORDER};border-radius:6px;padding:8px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,.4);min-width:160px;`;
    const ar = anchor.getBoundingClientRect();
    m.style.left = `${ar.left}px`;
    m.style.top = `${ar.bottom + 4}px`;

    // Color palette header
    const colorLabel = document.createElement('div');
    colorLabel.textContent = '色';
    colorLabel.style.cssText = `color:${TEXT_DIM};font-size:11px;margin-bottom:6px;`;
    m.appendChild(colorLabel);

    // Color grid
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-bottom:8px;`;

    const current = ctx.allPropColors.get(key)?.colorId;
    // No-color button
    const noneBtn = document.createElement('button');
    noneBtn.title = '色なし'; noneBtn.textContent = '×';
    noneBtn.style.cssText = `width:22px;height:22px;border-radius:4px;border:1.5px solid ${BORDER};background:transparent;cursor:pointer;font-size:11px;color:${TEXT_DIM};grid-column:span 2;`;
    noneBtn.addEventListener('click', () => {
      ctx.allPropColors.delete(key);
      void apiRemovePropertyColor(ctx.gId, key);
      m.remove();
      onDone();
      rowMap.forEach((_, id) => { const o = byId.get(id); if (o) updateExpandMarker(o); });
    });
    grid.appendChild(noneBtn);

    for (const [id, code] of ctx.colorPalette) {
      const btn = document.createElement('button');
      btn.title = id;
      btn.style.cssText = `width:22px;height:22px;border-radius:4px;border:${current === id ? `2px solid ${TEXT_HIGH}` : 'none'};background:${code};cursor:pointer;`;
      btn.addEventListener('click', () => {
        ctx.allPropColors.set(key, { colorId: id, code });
        void apiSetPropertyColor(ctx.gId, key, id);
        m.remove();
        onDone();
        rowMap.forEach((_, nid) => { const o = byId.get(nid); if (o) updateExpandMarker(o); });
      });
      grid.appendChild(btn);
    }
    m.appendChild(grid);

    // Divider + delete
    const div = document.createElement('div');
    div.style.cssText = `border-top:1px solid ${BORDER};margin:0 0 6px;`;
    m.appendChild(div);

    const deleteBtn = document.createElement('div');
    deleteBtn.textContent = '削除';
    deleteBtn.style.cssText = `padding:4px 6px;cursor:pointer;border-radius:4px;color:#e57373;`;
    deleteBtn.addEventListener('mouseenter', () => { deleteBtn.style.background = 'rgba(255,255,255,.08)'; });
    deleteBtn.addEventListener('mouseleave', () => { deleteBtn.style.background = ''; });
    deleteBtn.addEventListener('click', () => { m.remove(); deleteKey(key, onDone); });
    m.appendChild(deleteBtn);

    document.body.appendChild(m);
    requestAnimationFrame(() => {
      const r = m.getBoundingClientRect();
      if (r.right > window.innerWidth) m.style.left = `${window.innerWidth - r.width - 8}px`;
      if (r.bottom > window.innerHeight) m.style.top = `${ar.top - r.height - 2}px`;
    });
    const close = (e: MouseEvent) => {
      if (!m.contains(e.target as Node)) { m.remove(); document.removeEventListener('click', close, true); }
    };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  };

  // Build a Notion-style key list (shared by property menu and filter menu)
  // mode 'node': click pill toggles assignment on nodeId; mode 'filter': click pill toggles filterKeys
  // extOpts: when provided, overrides active/toggle behaviour for external callers (pane-filter / pane-sort)
  const buildKeyList = (
    container: HTMLElement,
    mode: 'node' | 'filter',
    nodeId: string | null,
    searchIn: HTMLInputElement,
    onRedraw: () => void,
    onClose?: () => void,
    extOpts?: {
      isActive: (key: string) => boolean;
      onToggle: (key: string) => void;
      getSuffix?: (key: string) => string;
    },
  ) => {
    container.innerHTML = '';
    let dragSrc: string | null = null;
    const nodeProps = nodeId ? (ctx.propStore.get(nodeId) ?? {}) : {};
    const filter = searchIn.value.trim().toLowerCase();
    // Use ctx.allPropKeys as master (shared across all panes); keyOrder provides sort order
    const masterKeys = [...new Set([...keyOrder, ...ctx.allPropKeys])];
    const keys = filter ? masterKeys.filter(k => k.toLowerCase().includes(filter)) : masterKeys;

    for (const key of keys) {
      const active = extOpts ? extOpts.isActive(key) : (mode === 'node' ? key in nodeProps : filterKeys.has(key));
      const propColor = ctx.allPropColors.get(key);
      const col = propColor?.code ?? TEXT_DIM;

      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:4px;padding:0 4px;border-radius:3px;cursor:pointer;border:2px solid transparent;`;
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,.05)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      // Click on the row (empty area) → toggle property
      row.addEventListener('click', (e) => {
        if (extOpts) { extOpts.onToggle(key); onRedraw(); return; }
        if (mode === 'node' && nodeId) {
          const onode = byId.get(nodeId);
          // Count properties BEFORE this change to detect "assigning the first property".
          const countBefore = Object.keys(ctx.propStore.get(nodeId) ?? {}).length;
          if (active) {
            syncPropChange(nodeId, p => { delete p[key]; });
            void apiRemoveProperty(ctx.gId, nodeId, key);
          } else {
            syncPropChange(nodeId, p => { p[key] = '●'; });
            void apiSetProperty(ctx.gId, nodeId, key, '●');
          }
          if (onode) updateExpandMarker(onode);
          // Auto-close (when Shift is not held) ONLY when this assigns the very first
          // property to a node that had none. Otherwise keep the menu open so the user
          // can keep tagging without re-opening it each time.
          const assignedFirst = !active && countBefore === 0;
          if (assignedFirst && !e.shiftKey && onClose) { onClose(); return; }
        } else if (mode === 'filter') {
          if (active) filterKeys.delete(key); else filterKeys.add(key);
          updateFilterBtn();
          render();
        }
        onRedraw();
      });

      // Square marker (filled=active, border-only=inactive) — replaces ⋯ + ⠿
      const sqBtn = document.createElement('span');
      sqBtn.style.cssText = `
        width:8px;height:8px;border-radius:1px;box-sizing:border-box;flex-shrink:0;cursor:pointer;
        ${active ? `background:${col};border:none;` : `background:transparent;border:1.5px solid ${TEXT_DIM};`}
      `;

      // Drag on square → reorder key; mouse: immediate drag, touch: long press (350ms, 5px threshold)
      let sqPressTimer: ReturnType<typeof setTimeout> | null = null;
      let sqDragStarted = false;
      let sqPressX = 0, sqPressY = 0;
      sqBtn.addEventListener('pointerdown', (e) => {
        sqDragStarted = false;
        sqPressX = e.clientX; sqPressY = e.clientY;
        if (e.pointerType === 'mouse') {
          row.draggable = true;
        } else {
          sqPressTimer = setTimeout(() => {
            row.draggable = true;
            row.style.opacity = '0.4';
          }, 350);
        }
      });
      const cancelSqPress = () => { if (sqPressTimer) { clearTimeout(sqPressTimer); sqPressTimer = null; } };
      sqBtn.addEventListener('pointerup', () => {
        cancelSqPress();
        if (!sqDragStarted) row.draggable = false;
      });
      sqBtn.addEventListener('pointermove', (e) => {
        if (!sqPressTimer) return;
        if (Math.abs(e.clientX - sqPressX) > 5 || Math.abs(e.clientY - sqPressY) > 5) cancelSqPress();
      });
      // Click on square → context menu only (stop propagation to prevent row toggle)
      sqBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sqDragStarted) return;
        showKeyContextMenu(key, sqBtn, onRedraw);
      });

      // Colored pill
      const pill = document.createElement('span');
      pill.textContent = key;
      pill.style.cssText = `display:inline-flex;align-items:center;padding:1px 6px;border-radius:3px;background:${col};color:#fff;font-size:11px;cursor:pointer;font-weight:500;white-space:nowrap;`;
      // pill click delegates to row's click handler (stop propagation to prevent double-fire)
      pill.addEventListener('click', (e) => { e.stopPropagation(); row.click(); });

      // DnD for key reordering
      row.addEventListener('dragstart', (e) => {
        sqDragStarted = true;
        dragSrc = key;
        e.dataTransfer!.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        sqDragStarted = false;
        row.style.opacity = '';
        row.draggable = false;
        dragSrc = null;
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        row.style.borderTop = `2px solid ${TEXT_MID}`;
        row.style.borderBottom = 'none';
      });
      row.addEventListener('dragleave', () => { row.style.borderTop = ''; });
      row.addEventListener('drop', (e) => {
        e.preventDefault(); row.style.borderTop = '';
        if (dragSrc && dragSrc !== key) {
          // Rebuild from the full displayed order (so keys not yet in keyOrder are handled)
          // and insert dragSrc immediately before the drop target — matching the top border.
          const order = [...new Set([...keyOrder, ...ctx.allPropKeys])].filter(k => k !== dragSrc);
          const ti = order.indexOf(key);
          if (ti >= 0) {
            order.splice(ti, 0, dragSrc);
            keyOrder = order;
            void apiSavePropertyOrder(ctx.gId, keyOrder);
          }
        }
        onRedraw();
      });

      row.append(sqBtn, pill);
      if (extOpts?.getSuffix) {
        const sf = extOpts.getSuffix(key);
        if (sf) {
          const sfEl = document.createElement('span');
          sfEl.textContent = sf;
          sfEl.style.cssText = `margin-left:auto;color:${TEXT_HIGH};font-size:11px;font-weight:600;padding-right:2px;`;
          row.appendChild(sfEl);
        }
      }
      container.appendChild(row);
    }

    // Create option if search text doesn't match existing key (not shown for external callers)
    const val = searchIn.value.trim();
    if (val && !keyOrder.includes(val) && !extOpts) {
      const createRow = document.createElement('div');
      createRow.style.cssText = `display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:4px;cursor:pointer;`;
      createRow.addEventListener('mouseenter', () => { createRow.style.background = 'rgba(255,255,255,.05)'; });
      createRow.addEventListener('mouseleave', () => { createRow.style.background = ''; });
      const handle2 = document.createElement('span');
      handle2.style.cssText = `width:13px;flex-shrink:0;`;
      const createPill = document.createElement('span');
      createPill.style.cssText = `flex:1;padding:3px 10px;border-radius:4px;background:${TEXT_DIM};color:#fff;font-size:12px;font-weight:500;`;
      createPill.textContent = `「${val}」を作成`;
      createRow.append(handle2, createPill);
      createRow.addEventListener('click', () => {
        addKeyToOrder(val, true);
        if (mode === 'node' && nodeId) {
          syncPropChange(nodeId, p => { p[val] = '●'; });
          void apiSetProperty(ctx.gId, nodeId, val, '●');
          const onode = byId.get(nodeId);
          if (onode) updateExpandMarker(onode);
        } else if (mode === 'filter') {
          filterKeys.add(val);
          updateFilterBtn();
          render();
        }
        searchIn.value = '';
        onRedraw();
      });
      container.appendChild(createRow);
    }
  };

  const showPropertyMenu = (onode: ONode, x: number, y: number) => {
    document.querySelector('[data-prop-menu]')?.remove();
    document.querySelector('[data-key-ctx-menu]')?.remove();
    document.querySelector('[data-color-picker]')?.remove();

    const menu = document.createElement('div');
    menu.dataset.propMenu = '1';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:100;width:260px;background:hsl(240,14%,9%);border:1px solid ${BORDER};border-radius:6px;padding:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.4);`;

    const rebuild = () => {
      menu.innerHTML = '';
      const nodeProps = ctx.propStore.get(onode.node.id) ?? {};

      // Selected tags row (shows assigned properties; × unlinks from this node only)
      const tagsEl = document.createElement('div');
      tagsEl.style.cssText = `display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;min-height:4px;`;
      const masterTagKeys = [...new Set([...keyOrder, ...ctx.allPropKeys])];
      for (const key of masterTagKeys) {
        if (!(key in nodeProps)) continue;
        const col = ctx.allPropColors.get(key)?.code ?? TEXT_DIM;
        const tag = document.createElement('span');
        tag.style.cssText = `display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;background:${col};color:#fff;font-size:12px;font-weight:500;`;
        const namePart = document.createElement('span'); namePart.textContent = key;
        const xBtn = document.createElement('button');
        xBtn.textContent = '×';
        xBtn.style.cssText = `background:transparent;border:none;color:#fff;opacity:.7;cursor:pointer;padding:0 0 0 3px;font-size:11px;line-height:1;`;
        xBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          // Unlink from this node only (NOT global delete)
          syncPropChange(onode.node.id, p => { delete p[key]; });
          void apiRemoveProperty(ctx.gId, onode.node.id, key);
          updateExpandMarker(onode);
          rebuild();
        });
        tag.append(namePart, xBtn);
        tagsEl.appendChild(tag);
      }
      menu.appendChild(tagsEl);

      // Search / create input
      const searchIn = document.createElement('input');
      searchIn.placeholder = '';
      searchIn.style.cssText = `width:100%;box-sizing:border-box;background:transparent;border:1px solid ${BORDER};border-radius:3px;padding:4px 6px;color:${TEXT_HIGH};font-size:12px;outline:none;font-family:inherit;margin-bottom:4px;`;
      menu.appendChild(searchIn);

      const divider = document.createElement('div');
      divider.style.cssText = `border-top:1px solid ${BORDER};margin:2px 0 4px;`;
      menu.appendChild(divider);

      // Key list
      const listContainer = document.createElement('div');
      listContainer.style.cssText = `max-height:220px;overflow-y:auto;`;
      const closeMenu = () => { menu.remove(); };
      searchIn.addEventListener('input', () => buildKeyList(listContainer, 'node', onode.node.id, searchIn, rebuild, closeMenu));
      searchIn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const val = searchIn.value.trim();
        if (!val) return;
        addKeyToOrder(val, true);
        const nodeProps = ctx.propStore.get(onode.node.id) ?? {};
        if (!(val in nodeProps)) {
          syncPropChange(onode.node.id, p => { p[val] = '●'; });
          void apiSetProperty(ctx.gId, onode.node.id, val, '●');
          updateExpandMarker(onode);
        }
        searchIn.value = '';
        rebuild();
      });
      buildKeyList(listContainer, 'node', onode.node.id, searchIn, rebuild, closeMenu);
      menu.appendChild(listContainer);
    };

    rebuild();
    document.body.appendChild(menu);
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth) menu.style.left = `${window.innerWidth - r.width - 8}px`;
      if (r.bottom > window.innerHeight) menu.style.top = `${y - r.height}px`;
    });
    const onOutside = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!menu.contains(t) && !t?.closest('[data-key-ctx-menu]') && !t?.closest('[data-color-picker]'))
        { menu.remove(); document.removeEventListener('mousedown', onOutside); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.querySelector('[data-key-ctx-menu]')?.remove();
        document.querySelector('[data-color-picker]')?.remove();
        menu.remove(); document.removeEventListener('keydown', onKey);
      }
    };
    setTimeout(() => { document.addEventListener('mousedown', onOutside); document.addEventListener('keydown', onKey); }, 0);
  };

  // ── Key management menu for pane filter (called from multi-pane) ────
  const openKeyMenu = (opts: {
    anchor: HTMLElement;
    mode: 'pane-filter';
    isActive: (key: string) => boolean;
    onToggle: (key: string) => void;
  }) => {
    document.querySelector('[data-key-mgmt-menu]')?.remove();
    document.querySelector('[data-key-ctx-menu]')?.remove();
    document.querySelector('[data-color-picker]')?.remove();

    const menu = document.createElement('div');
    menu.dataset.keyMgmtMenu = '1';
    const ar = opts.anchor.getBoundingClientRect();
    menu.style.cssText = `position:fixed;left:${ar.left}px;top:${ar.bottom + 2}px;z-index:200;width:220px;background:hsl(240,14%,9%);border:1px solid ${BORDER};border-radius:6px;padding:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.4);`;

    const rebuild = () => {
      menu.innerHTML = '';
      const searchIn = document.createElement('input');
      searchIn.placeholder = '';
      searchIn.style.cssText = `width:100%;box-sizing:border-box;background:transparent;border:1px solid ${BORDER};border-radius:3px;padding:4px 6px;color:${TEXT_HIGH};font-size:12px;outline:none;font-family:inherit;margin-bottom:4px;`;
      const divider = document.createElement('div');
      divider.style.cssText = `border-top:1px solid ${BORDER};margin:2px 0 4px;`;
      const listContainer = document.createElement('div');
      listContainer.style.cssText = `max-height:220px;overflow-y:auto;`;
      const ext = { isActive: opts.isActive, onToggle: opts.onToggle };
      searchIn.addEventListener('input', () => buildKeyList(listContainer, 'node', null, searchIn, rebuild, undefined, ext));
      buildKeyList(listContainer, 'node', null, searchIn, rebuild, undefined, ext);
      menu.append(searchIn, divider, listContainer);
      searchIn.focus();
    };

    rebuild();
    document.body.appendChild(menu);
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth) menu.style.left = `${window.innerWidth - r.width - 8}px`;
      if (r.bottom > window.innerHeight) menu.style.top = `${ar.top - r.height - 2}px`;
    });
    const onOutside = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!menu.contains(t) && !t?.closest('[data-key-ctx-menu]') && !t?.closest('[data-color-picker]'))
        { menu.remove(); document.removeEventListener('mousedown', onOutside); }
    };
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  };

  // ── Link-search (/) ──────────────────────────────────────────────────

  const doLinkSearch = (onode: ONode) => {
    // Close any existing search panel
    (listEl.querySelector('[data-link-search]') as HTMLElement | null)?.remove();

    const row = rowMap.get(onode.node.id);
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
      restoreRow();

      // Replace current onode's data with the found node (in-place)
      byId.delete(oldId);
      rowMap.delete(oldId);
      onode.node = node;
      byId.set(node.id, onode);
      row.dataset.nodeId = node.id;
      rowMap.set(node.id, row);

      // Update textarea to show found node's label
      ta.value = (primaryLabel(node, ctx.state.lang) ?? fallbackLabel(node, ctx.state.lang)) || '';

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
        const lang = ctx.state.showFallback ? undefined : ctx.state.lang;
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
          const lbl = (primaryLabel(n, ctx.state.lang) ?? fallbackLabel(n, ctx.state.lang)) || n.id.slice(0, 8);
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
    const vis = flatVisible();
    const firstIdx = vis.indexOf(sel[0]);
    clearSelection();
    for (const n of sel) {
      if (n.expanded) collapseInDom(n);
      rowMap.get(n.node.id)?.remove(); rowMap.delete(n.node.id);
      const sibs = getSiblings(n);
      const idx = sibs.indexOf(n); if (idx !== -1) sibs.splice(idx, 1);
      byId.delete(n.node.id);
      const cc = ctx.childrenCache.get(n.parentId);
      if (cc) { const ci = cc.findIndex(x => x.id === n.node.id); if (ci >= 0) cc.splice(ci, 1); }
      void apiDeleteNode(ctx.gId, n.node.id);
    }
    const selSet = new Set(sel.map(n => n.node.id));
    const remaining = vis.filter(n => !selSet.has(n.node.id));
    const target = remaining[Math.max(0, firstIdx - 1)] ?? remaining[0];
    if (target && byId.has(target.node.id)) focusRow(target);
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
  // since resolved are picked up). Falls back to roots for the pane/root level whose parent
  // node isn't itself a row in this pane.
  const siblingIdsForParent = (parentId: string): string[] =>
    (byId.get(parentId)?.children ?? roots).map(s => s.node.id);

  const sendReorder = (parentId: string, keepalive = false): Promise<void> => {
    const order = siblingIdsForParent(parentId);
    if (order.length === 0) return Promise.resolve();
    return apiMoveNode(ctx.gId, order[0], parentId, 'down', order, keepalive);
  };

  const flushReorder = async (parentId: string) => {
    // Never send a temp id — wait for any pending creates in this sibling set to resolve.
    const ids = siblingIdsForParent(parentId);
    await Promise.all(ids.map(id => { const o = byId.get(id); return o ? awaitRealId(o) : Promise.resolve(); }));
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
      const firstGroupRow = rowMap.get(sel[0].node.id);
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
    const parentONode = byId.get(parentId);
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

    // Re-parent and fix depths
    const newDepth = targetParent.depth + 1;
    for (const n of sel) { n.parentId = targetParent.node.id; fixDepths(n, newDepth); }

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
      for (const n of sel) { if (byId.has(n.node.id)) await doDedent(n); }
    } else {
      for (const n of [...sel].reverse()) {
        if (!byId.has(n.node.id)) continue;
        const v = flatVisible(); const ii = v.indexOf(n);
        if (ii > 0) await doIndent(n, v, ii);
      }
    }
  };

  // ── Node operations ───────────────────────────────────────────────────

  const doAddSibling = async (onode: ONode, before = false) => {
    const tempId = `temp-${++ctx.tempNodeCounter}`;
    const tempNode: ExplorerNode = { id: tempId };
    const sibs = getSiblings(onode);
    const idx = sibs.indexOf(onode);
    // Capture previous sibling before splice (needed when inserting before the first node)
    const prevSibNode = before && idx > 0 ? sibs[idx - 1] : undefined;
    const no = make(tempNode, onode.parentId, onode.depth);
    no.childrenLoaded = true;
    sibs.splice(before ? idx : idx + 1, 0, no);

    let newRow: HTMLElement;
    if (before) {
      const ownRow = rowMap.get(onode.node.id);
      if (!ownRow) { sibs.splice(sibs.indexOf(no), 1); byId.delete(tempId); return; }
      newRow = buildRow(no);
      ownRow.insertAdjacentElement('beforebegin', newRow);
    } else {
      const anchor = lastDescRow(onode);
      if (!anchor) { sibs.splice(sibs.indexOf(no), 1); byId.delete(tempId); return; }
      newRow = buildRow(no);
      anchor.insertAdjacentElement('afterend', newRow);
    }
    focusRow(no);

    // Register promise so operations on this temp node can wait for the real ID
    let resolveTemp!: () => void;
    tempReady.set(tempId, new Promise<void>(res => { resolveTemp = res; }));

    // For "before first node" (no prevSib), insertAfterId=undefined → backend appends, then reorder
    const insertAfterId = before ? prevSibNode?.node.id : onode.node.id;
    const nn = await apiCreateNode(ctx.gId, onode.parentId, ctx.state.lang, '', insertAfterId);
    if (!nn) {
      resolveTemp();
      tempReady.delete(tempId);
      newRow.remove(); rowMap.delete(tempId);
      sibs.splice(sibs.indexOf(no), 1); byId.delete(tempId);
      focusRow(onode);
      return;
    }

    const typedText = newRow.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '';
    byId.delete(tempId); byId.set(nn.id, no);
    rowMap.delete(tempId); rowMap.set(nn.id, newRow);
    newRow.dataset.nodeId = nn.id;
    Object.assign(tempNode, nn);
    resolveTemp();
    tempReady.delete(tempId);

    const cc = ctx.childrenCache.get(onode.parentId);
    if (cc) { const ci = cc.findIndex(n => n.id === onode.node.id); if (ci >= 0) cc.splice(before ? ci : ci + 1, 0, nn); }

    // If inserting before the first node, the backend appended it to chain end → move to front
    if (before && !prevSibNode && onode.parentId !== null) {
      void apiMoveNode(ctx.gId, nn.id, onode.parentId, 'up', sibs.map(n => n.node.id));
    }

    ctx.saveChildrenCache?.();
    if (typedText.trim()) void apiUpdateNode(ctx.gId, nn.id, ctx.state.lang, typedText);
  };

  const doDelete = (onode: ONode, visIdx: number, vis: ONode[]) => {
    if (onode.expanded) collapseInDom(onode);
    rowMap.get(onode.node.id)?.remove(); rowMap.delete(onode.node.id);
    const sibs = getSiblings(onode);
    sibs.splice(sibs.indexOf(onode), 1);
    byId.delete(onode.node.id);
    const cc = ctx.childrenCache.get(onode.parentId);
    if (cc) { const ci = cc.findIndex(n => n.id === onode.node.id); if (ci >= 0) cc.splice(ci, 1); }
    const target = vis[visIdx - 1] ?? vis[visIdx + 1];
    if (target && byId.has(target.node.id)) focusRow(target);
    void apiDeleteNode(ctx.gId, onode.node.id);
  };

  const doMove = async (onode: ONode, direction: 'up' | 'down') => {
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
        const neighborRow = rowMap.get(neighbor.node.id);
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
    if (onode.parentId === null) return;
    const parentONode = byId.get(onode.parentId);
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
    fixDepths(onode, targetParent.depth + 1);
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
    const oldCc = ctx.childrenCache.get(oldParentId);
    if (oldCc) { const ci = oldCc.findIndex(n => n.id === onode.node.id); if (ci >= 0) oldCc.splice(ci, 1); }

    onode.parentId = prev.node.id;
    fixDepths(onode, prev.depth + 1);
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
    if (onode.parentId === null) return;
    const parent = byId.get(onode.parentId);
    if (!parent) return;
    const oldParentId = onode.parentId;

    parent.children.splice(parent.children.indexOf(onode), 1);
    ctx.childrenCache.delete(oldParentId);

    const grandSibs = getSiblings(parent);
    const parentIdx = grandSibs.indexOf(parent);
    onode.parentId = parent.parentId;
    fixDepths(onode, parent.depth);
    grandSibs.splice(parentIdx + 1, 0, onode);
    if (onode.parentId !== null) ctx.childrenCache.delete(onode.parentId);

    render();
    focusRow(onode);

    await awaitRealId(onode);
    void apiToggleLink(ctx.gId, onode.node.id, oldParentId);
    if (onode.parentId !== null) void apiToggleLink(ctx.gId, onode.node.id, onode.parentId);
  };

  // Merge node properties into propStore and register all keys into allPropKeys
  const seedPropStore = (nodes: ExplorerNode[]) => {
    for (const n of nodes) {
      if (n.properties && Object.keys(n.properties).length > 0) {
        ctx.propStore.set(n.id, { ...ctx.propStore.get(n.id), ...n.properties });
        for (const k of Object.keys(n.properties)) addKeyToOrder(k);
      }
    }
  };

  // Shallow structural comparison of two child lists — detects whether a revalidation
  // fetch returned anything that affects rendering (order, labels, color, properties).
  const childrenDiffer = (a: ExplorerNode[], b: ExplorerNode[]): boolean => {
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x.id !== y.id || (x.en ?? '') !== (y.en ?? '') || (x.ja ?? '') !== (y.ja ?? '') || (x.color ?? '') !== (y.color ?? '')) return true;
      const xk = Object.keys(x.properties ?? {}).sort();
      const yk = Object.keys(y.properties ?? {}).sort();
      if (xk.length !== yk.length) return true;
      for (let j = 0; j < xk.length; j++) {
        if (xk[j] !== yk[j] || (x.properties as Record<string, string>)[xk[j]] !== (y.properties as Record<string, string>)[yk[j]]) return true;
      }
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
    toRoots: (nodes: ExplorerNode[]) => ONode[],
  ) => {
    const fresh = await fetchChildrenFiltered(fetchId);
    if (fresh.length === 0 && painted && painted.length > 0) return; // suspected transient error
    setCachedChildren(cacheKey, fresh);
    validated.add(cacheKey);
    seedPropStore(fresh);
    if (painted && !childrenDiffer(painted, fresh)) return; // nothing changed since the paint
    if (listEl.contains(document.activeElement)) return;     // don't clobber an active edit
    byId.clear();
    roots = toRoots(fresh);
    render();
  };

  const load = async () => {
    flushPendingReorders(); // send any queued reorder before the tree is rebuilt
    byId.clear();
    zoomStack.splice(0);
    baseDepth = 0;
    updateBreadcrumb();

    // Load color palette, property key colors, and key order (parallel, best-effort)
    if (ctx.colorPalette.size === 0) {
      const [palette, propColors, savedOrder, allKeys] = await Promise.all([
        fetchColors(ctx.gId),
        fetchPropertyColors(ctx.gId),
        fetchPropertyOrder(ctx.gId),
        fetchAllPropertyKeys(ctx.gId),
      ]);
      ctx.colorPalette.clear();
      for (const { id, code } of palette) ctx.colorPalette.set(id, code);
      ctx.allPropColors.clear();
      for (const [key, val] of Object.entries(propColors)) ctx.allPropColors.set(key, val);
      keyOrder = savedOrder.filter(k => k.length > 0);
      // Seed allPropKeys from both saved order and all keys actually present on nodes
      for (const k of keyOrder) ctx.allPropKeys.add(k);
      for (const k of allKeys) {
        if (!keyOrder.includes(k)) keyOrder.push(k);
        ctx.allPropKeys.add(k);
      }
    }

    // Pane-specific parent override
    if (paneParentSet) {
      if (paneParentId !== null) {
        const pid = paneParentId;
        // Exclude the pane parent itself (appears via undirected edges)
        const toRoots = (nodes: ExplorerNode[]) => nodes.filter(n => n.id !== pid).map(n => make(n, pid, 0));
        const cached = ctx.childrenCache.get(pid);
        if (cached) {
          seedPropStore(cached);
          roots = toRoots(cached);
          render();
        }
        await revalidate(pid, pid, cached, toRoots);
      } else {
        roots = [];
        render();
      }
      return;
    }

    if (ctx.rootNodeId) {
      const rootId = ctx.rootNodeId;
      const toRoots = (nodes: ExplorerNode[]) => nodes.map(n => make(n, rootId, 0));
      // Use same cache key (null) as column view so both views share the same root node list
      const cached = ctx.childrenCache.get(null);
      if (cached) {
        seedPropStore(cached);
        roots = toRoots(cached);
        render();
      }
      // Stale-while-revalidate against the backend so edits persisted since the cache was
      // written are reflected on reload (rather than reverting to the cached snapshot).
      await revalidate(null, rootId, cached, toRoots);
      return;
    }

    // Bookmarks root (no rootNodeId): always fetched fresh, no persistent cache.
    if (ctx.state.bookmarks.size === 0) {
      const ids = await fetchBookmarks(ctx.gId);
      ctx.state.bookmarks = new Set(ids);
    }
    const lang = ctx.state.showFallback ? undefined : ctx.state.lang;
    const { nodes } = await fetchBookmarkedNodes(ctx.gId, [...ctx.state.bookmarks], lang);
    seedPropStore(nodes);
    roots = nodes.map(n => make(n, null, 0));
    render();
  };

  const getAncestorIds = (nodeId: string): Set<string> => {
    const result = new Set<string>();
    let current = byId.get(nodeId);
    while (current?.parentId) {
      result.add(current.parentId);
      current = byId.get(current.parentId);
    }
    return result;
  };

  const setParent = async (nodeId: string | null, excludeIds?: Set<string>, path?: PathEntry[]) => {
    paneParentSet = true;
    paneParentId = nodeId;
    externalPath = path ?? [];
    paneSelectedId = null;
    byId.clear();
    zoomStack.splice(0);
    baseDepth = 0;
    updateBreadcrumb();
    if (nodeId !== null) {
      const nid = nodeId;
      // Exclude the pane parent itself and any specified ancestors (they appear via undirected edges)
      const excl = new Set([nid, ...(excludeIds ?? [])]);
      const toRoots = (nodes: ExplorerNode[]) => nodes.filter(n => !excl.has(n.id)).map(n => make(n, nid, 0));
      const cached = ctx.childrenCache.get(nid);
      if (cached) {
        seedPropStore(cached);
        roots = toRoots(cached);
        render();
      }
      await revalidate(nid, nid, cached, toRoots);
    } else {
      roots = [];
      render();
    }
  };

  const getSelectedId = () => paneSelectedId;
  // Current parent whose children form this pane's rows (null = root/none). Used by the
  // multi-pane "固定" toggle to snapshot the frozen view.
  const getPaneParentId = () => (paneParentSet ? paneParentId : null);
  const setPaneFilterKeys = (keys: Set<string>) => { paneFilterKeys = keys; render(); };
  const setPaneSortByProps = (enabled: boolean) => { paneSortByProps = enabled; render(); };

  // Reset this pane back to the graph root (source = ルート). Clears any pane-parent state
  // so load() takes the root branch — otherwise a stale paneParentId would keep showing the
  // previously-sourced node's children.
  const setSourceRoot = async () => {
    paneParentSet = false;
    paneParentId = null;
    externalPath = [];
    paneSelectedId = null;
    byId.clear();
    zoomStack.splice(0);
    baseDepth = 0;
    await load();
  };

  // One-shot action: physically reorder each loaded sibling group (top level + every
  // expanded parent's children) into property-sort order and persist it to the backend,
  // so the stored order — not just the view — reflects the sort.
  const applyPropertySort = async () => {
    const parents: (string | null)[] = [paneParentSet ? paneParentId : (ctx.rootNodeId ?? null)];
    roots.sort(compareByProps);
    byId.forEach(o => {
      if (o.childrenLoaded && o.children.length > 1) {
        o.children.sort(compareByProps);
        parents.push(o.node.id);
      }
    });
    render();
    for (const pid of parents) {
      if (pid !== null) await sendReorder(pid);
    }
    showToast('並び順を保存しました');
  };

  const search = async (query: string) => {
    if (!query) { await load(); return; }
    byId.clear(); zoomStack.splice(0); baseDepth = 0;
    updateBreadcrumb();
    const lang = ctx.state.showFallback ? undefined : ctx.state.lang;
    const { nodes } = await fetchAllNodes(ctx.gId, [], 0, lang, undefined, query, 50);
    seedPropStore(nodes);
    roots = nodes.map(n => make(n, null, 0));
    render();
  };

  updateBreadcrumb(); // show "ルート" on initial render

  // Register targeted hook: when a node's property changes, update or remove its row
  const propHook = (changedId: string) => {
    // Update expand marker if node is in this pane's tree
    const onode = byId.get(changedId);
    if (onode) updateExpandMarker(onode);

    const activeFilter = paneFilterKeys.size > 0 ? paneFilterKeys : filterKeys.size > 0 ? filterKeys : null;
    if (!activeFilter) return; // no filter → all rows stay visible regardless of prop change

    const row = rowMap.get(changedId);
    const props = ctx.propStore.get(changedId) ?? {};
    const shouldShow = [...activeFilter].some(k => k in props);

    if (row && !shouldShow) {
      // Node visible but no longer matches filter → remove from DOM immediately
      row.remove();
      rowMap.delete(changedId);
    } else if (!row && shouldShow && onode) {
      // Node hidden but now matches filter → full render to re-add it
      render();
    }
  };
  ctx.propChangeHooks.push(propHook);
  const unregister = () => {
    flushPendingReorders(true);
    window.removeEventListener('pagehide', onPageHide);
    const i = ctx.propChangeHooks.indexOf(propHook);
    if (i >= 0) ctx.propChangeHooks.splice(i, 1);
  };

  return { el, filterBtn, load, refresh: render, search, setParent, getAncestorIds, getNodePath, getSelectedId, getPaneParentId, setPaneFilterKeys, setPaneSortByProps, setSourceRoot, applyPropertySort, beginKeyMove, acceptKeyMove, getEffectiveParentId, getNodeParentId, openKeyMenu, unregister };
}
