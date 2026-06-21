import type { ExplorerNode, GraphEditorContext } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, primaryLabel, fallbackLabel } from './constants';
import {
  fetchChildren, fetchBookmarks, fetchBookmarkedNodes, fetchAllNodes,
  apiCreateNode, apiUpdateNode, apiDeleteNode, apiMoveNode, apiMoveBookmark, apiToggleLink,
  apiSetProperty, apiRemoveProperty, apiDeletePropertyKey,
  fetchColors, fetchPropertyColors, apiSetPropertyColor, apiRemovePropertyColor,
  fetchPropertyOrder, apiSavePropertyOrder,
} from './api';

type ONode = {
  node: ExplorerNode;
  parentId: string | null;
  depth: number;
  expanded: boolean;
  childrenLoaded: boolean;
  children: ONode[];
};

export type OutlinerPaneOpts = {
  /** If set, this pane shows children of this node (null = empty until setParent called) */
  paneParentId?: string | null;
  /** Only show nodes that have ALL of these property keys */
  paneFilterKeys?: Set<string>;
  /** Called when user focuses a node row (for inter-pane wiring) */
  onNodeSelect?: (nodeId: string | null) => void;
};

export function createOutlinerView(ctx: GraphEditorContext, paneOpts?: OutlinerPaneOpts): {
  el: HTMLElement;
  filterBtn: HTMLElement;
  load: () => Promise<void>;
  refresh: () => void;
  search: (query: string) => Promise<void>;
  setParent: (nodeId: string | null) => Promise<void>;
  getSelectedId: () => string | null;
  setPaneFilterKeys: (keys: Set<string>) => void;
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

  const addKeyToOrder = (key: string) => {
    if (!keyOrder.includes(key)) keyOrder.push(key);
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
        if (!keyOrder.includes(val)) {
          addKeyToOrder(val);
          void apiSavePropertyOrder(ctx.gId, keyOrder);
        }
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

  // Scrollable list
  const listEl = document.createElement('div');
  listEl.dataset.outlinerList = '1';
  listEl.style.cssText = `flex:1;overflow-y:auto;overflow-x:hidden;padding:4px 0 4px 10px;`;
  el.appendChild(listEl);

  let roots: ONode[] = [];
  let baseDepth = 0; // depth of current root level (for relative indent display)
  const byId = new Map<string, ONode>();
  const rowMap = new Map<string, HTMLElement>();

  // Pane state
  let paneParentSet = paneOpts?.paneParentId !== undefined;
  let paneParentId: string | null = paneOpts?.paneParentId ?? null;
  let paneSelectedId: string | null = null;
  let paneFilterKeys: Set<string> = paneOpts?.paneFilterKeys ?? new Set();

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
    // Apply per-pane filter (ALL keys must be present)
    const toRender = paneFilterKeys.size > 0
      ? base.filter(o => {
          const props = ctx.propStore.get(o.node.id) ?? {};
          return [...paneFilterKeys].every(k => k in props);
        })
      : base;
    for (const o of toRender) listEl.appendChild(buildRow(o));
    updateSelectionHighlight();
    schedulePrefetch();
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

  const lastDescRow = (onode: ONode): HTMLElement => {
    if (onode.expanded && onode.children.length > 0)
      return lastDescRow(onode.children[onode.children.length - 1]);
    return rowMap.get(onode.node.id)!;
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

  const ensureChildren = async (onode: ONode) => {
    if (onode.childrenLoaded) return;
    let cached = ctx.childrenCache.get(onode.node.id);
    if (!cached) {
      cached = await fetchChildren(ctx.gId, onode.node.id, ctx.limit);
      ctx.childrenCache.set(onode.node.id, cached);
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
    // Use first assigned property color, if any
    const nodeProps = ctx.propStore.get(onode.node.id) ?? {};
    const propColor = Object.keys(nodeProps)
      .map(k => ctx.allPropColors.get(k)?.code)
      .find(c => c != null);
    if (propColor) {
      m.style.background = propColor;
      m.style.border = 'none';
    } else {
      m.style.background = hasChildren && !onode.expanded ? TEXT_MID : TEXT_DIM;
      m.style.border = 'none';
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
    let anchor = rowMap.get(onode.node.id)!;
    const insertSubtree = (list: ONode[]) => {
      for (const child of list) {
        const row = buildRow(child);
        anchor.insertAdjacentElement('afterend', row);
        anchor = row;
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
    focusRow(onode);
  };

  // ── Breadcrumb ───────────────────────────────────────────────────────
  const updateBreadcrumb = () => {
    bcEl.innerHTML = '';

    const btnStyle = (active: boolean) =>
      `background:transparent;border:none;color:${active ? TEXT_HIGH : TEXT_MID};cursor:${active ? 'default' : 'pointer'};font-size:12px;padding:0 2px;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;`;

    if (zoomStack.length === 0) {
      const span = document.createElement('span');
      span.textContent = 'ルート';
      span.style.cssText = `color:${TEXT_HIGH};font-size:12px;padding:0 2px;`;
      bcEl.appendChild(span);
      return;
    }

    const homeBtn = document.createElement('button');
    homeBtn.textContent = 'ルート';
    homeBtn.style.cssText = btnStyle(false);
    homeBtn.addEventListener('click', () => void doZoomTo(0));
    bcEl.appendChild(homeBtn);

    zoomStack.forEach((on, i) => {
      const sep = document.createElement('span');
      sep.textContent = ' › ';
      sep.style.color = TEXT_DIM;
      bcEl.appendChild(sep);

      const btn = document.createElement('button');
      const lbl = primaryLabel(on.node, ctx.state.lang) ?? fallbackLabel(on.node, ctx.state.lang) ?? on.node.id.slice(0, 8);
      btn.textContent = lbl;
      btn.title = lbl;
      btn.style.cssText = btnStyle(i === zoomStack.length - 1);
      if (i < zoomStack.length - 1) btn.addEventListener('click', () => void doZoomTo(i + 1));
      bcEl.appendChild(btn);
    });
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
  // Active drag state for node reordering
  let dragNodeId: string | null = null;
  let dragParentId: string | null | undefined = undefined;

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
    row.appendChild(btnWrap);

    const label = primaryLabel(onode.node, ctx.state.lang) ?? fallbackLabel(onode.node, ctx.state.lang);
    const ta = document.createElement('textarea');
    ta.value = label;
    ta.style.cssText = `flex:1;background:transparent;border:none;outline:none;resize:none;font-size:14px;font-family:inherit;line-height:1.5;padding:0 4px 0 0;overflow:hidden;min-height:20px;color:${onode.node.color ?? TEXT_HIGH};`;
    ta.rows = 1;

    const resize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    requestAnimationFrame(resize);
    ta.addEventListener('input', resize);
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
        e.preventDefault(); clearSelection(); void doAddSibling(onode);
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
      dragReady = false;
      pressTimer = setTimeout(() => {
        dragReady = true;
        row.draggable = true;
        row.style.opacity = '0.6';
      }, 350);
    });
    row.addEventListener('pointermove', (e) => {
      if (!pressTimer) return;
      if (Math.abs(e.clientX - pressStartX) > 5 || Math.abs(e.clientY - pressStartY) > 5) cancelPress();
    });
    row.addEventListener('pointerup', cancelPress);
    row.addEventListener('pointercancel', cancelPress);

    row.addEventListener('dragstart', (e) => {
      if (!dragReady) { e.preventDefault(); return; }
      dragNodeId = onode.node.id;
      dragParentId = onode.parentId;
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', onode.node.id); }
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.style.opacity = '';
      dragReady = false;
      dragNodeId = null;
      dragParentId = undefined;
      listEl.querySelectorAll<HTMLElement>('[data-node-id]').forEach(r => { r.style.borderTop = '2px solid transparent'; r.style.borderBottom = '2px solid transparent'; });
    });
    row.addEventListener('dragover', (e) => {
      if (!dragNodeId || dragNodeId === onode.node.id || onode.parentId !== dragParentId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const before = e.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      row.style.borderTop = before ? '2px solid #4a9eff' : '2px solid transparent';
      row.style.borderBottom = before ? '2px solid transparent' : '2px solid #4a9eff';
    });
    row.addEventListener('dragleave', () => {
      row.style.borderTop = '2px solid transparent';
      row.style.borderBottom = '2px solid transparent';
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.style.borderTop = '2px solid transparent';
      row.style.borderBottom = '2px solid transparent';
      if (!dragNodeId || dragNodeId === onode.node.id || onode.parentId !== dragParentId) return;
      const srcONode = byId.get(dragNodeId);
      if (!srcONode) return;
      const before = e.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      const sibs = getSiblings(onode);
      const newOrder = sibs.filter(s => s.node.id !== dragNodeId);
      const targetIdx = newOrder.findIndex(s => s.node.id === onode.node.id);
      if (targetIdx === -1) return;
      newOrder.splice(before ? targetIdx : targetIdx + 1, 0, srcONode);
      const parentONode = onode.parentId ? byId.get(onode.parentId) : null;
      if (parentONode) parentONode.children = newOrder; else roots = newOrder;
      render();
      if (onode.parentId) void apiMoveNode(ctx.gId, dragNodeId!, onode.parentId, 'down', newOrder.map(s => s.node.id));
    });

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
  const buildKeyList = (
    container: HTMLElement,
    mode: 'node' | 'filter',
    nodeId: string | null,
    searchIn: HTMLInputElement,
    onRedraw: () => void,
    onClose?: () => void,
  ) => {
    container.innerHTML = '';
    let dragSrc: string | null = null;
    const nodeProps = nodeId ? (ctx.propStore.get(nodeId) ?? {}) : {};
    const filter = searchIn.value.trim().toLowerCase();
    const keys = filter ? keyOrder.filter(k => k.toLowerCase().includes(filter)) : keyOrder;

    for (const key of keys) {
      const active = mode === 'node' ? key in nodeProps : filterKeys.has(key);
      const propColor = ctx.allPropColors.get(key);
      const col = propColor?.code ?? TEXT_DIM;

      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:5px;padding:3px 4px;border-radius:4px;cursor:default;border:2px solid transparent;`;
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,.05)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });

      // Square marker (filled=active, border-only=inactive) — replaces ⋯ + ⠿
      const sqBtn = document.createElement('span');
      sqBtn.style.cssText = `
        width:8px;height:8px;border-radius:1px;box-sizing:border-box;flex-shrink:0;cursor:pointer;
        ${active ? `background:${col};border:none;` : `background:transparent;border:1.5px solid ${TEXT_DIM};`}
      `;

      // Long press on square → enable DnD
      let sqPressTimer: ReturnType<typeof setTimeout> | null = null;
      let sqDragActive = false;
      sqBtn.addEventListener('pointerdown', () => {
        sqDragActive = false;
        sqPressTimer = setTimeout(() => {
          sqDragActive = true;
          row.draggable = true;
          row.style.opacity = '0.4';
        }, 350);
      });
      const cancelSqPress = () => { if (sqPressTimer) { clearTimeout(sqPressTimer); sqPressTimer = null; } };
      sqBtn.addEventListener('pointerup', cancelSqPress);
      sqBtn.addEventListener('pointermove', cancelSqPress);
      // Click on square → context menu
      sqBtn.addEventListener('click', (e) => {
        if (sqDragActive) { sqDragActive = false; return; }
        e.stopPropagation();
        showKeyContextMenu(key, sqBtn, onRedraw);
      });

      // Colored pill
      const pill = document.createElement('span');
      pill.textContent = key;
      pill.style.cssText = `display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;background:${col};color:#fff;font-size:12px;cursor:pointer;font-weight:500;white-space:nowrap;`;
      pill.addEventListener('click', (e) => {
        if (mode === 'node' && nodeId) {
          const onode = byId.get(nodeId);
          if (active) {
            syncPropChange(nodeId, p => { delete p[key]; });
            void apiRemoveProperty(ctx.gId, nodeId, key);
          } else {
            syncPropChange(nodeId, p => { p[key] = '●'; });
            void apiSetProperty(ctx.gId, nodeId, key, '●');
          }
          if (onode) updateExpandMarker(onode);
          if (!e.shiftKey && onClose) { onClose(); return; }
        } else if (mode === 'filter') {
          if (active) filterKeys.delete(key); else filterKeys.add(key);
          updateFilterBtn();
          render();
        }
        onRedraw();
      });

      // DnD (activated by long press on square)
      row.addEventListener('dragstart', (e) => {
        dragSrc = key;
        e.dataTransfer!.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        row.style.opacity = '';
        row.draggable = false;
        sqDragActive = false;
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
          const fi = keyOrder.indexOf(dragSrc), ti = keyOrder.indexOf(key);
          if (fi >= 0 && ti >= 0) {
            keyOrder.splice(fi, 1);
            keyOrder.splice(ti, 0, dragSrc);
            void apiSavePropertyOrder(ctx.gId, keyOrder);
          }
        }
        onRedraw();
      });

      row.append(sqBtn, pill);
      container.appendChild(row);
    }

    // Create option if search text doesn't match existing key
    const val = searchIn.value.trim();
    if (val && !keyOrder.includes(val)) {
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
        addKeyToOrder(val);
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

      // Selected tags row
      const tagsEl = document.createElement('div');
      tagsEl.style.cssText = `display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;min-height:4px;`;
      for (const key of keyOrder) {
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
          deleteKey(key, rebuild);
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
        if (!keyOrder.includes(val)) {
          addKeyToOrder(val);
          void apiSavePropertyOrder(ctx.gId, keyOrder);
        }
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
        const visIds = new Set(flatVisible().map(n => n.node.id));
        resultNodes = nodes.filter(n => !visIds.has(n.id));
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
      let anchor: HTMLElement = lastDescRow(sel[sel.length - 1]);
      for (const r of displacedRows) { anchor.insertAdjacentElement('afterend', r); anchor = r; }
      const cc = ctx.childrenCache.get(parentId);
      if (cc) { const order = new Map(sibs.map((n, i) => [n.node.id, i])); cc.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)); }
      updateSelectionHighlight();
      if (parentId !== null) void apiMoveNode(ctx.gId, sel[0].node.id, parentId, direction, sibs.map(n => n.node.id));
      return;
    }
    if (direction === 'down' && maxIdx < sibs.length - 1) {
      const displaced = sibs[maxIdx + 1];
      sibs.splice(maxIdx + 1, 1); sibs.splice(minIdx, 0, displaced);
      const displacedRows = visibleRowGroup(displaced);
      const firstGroupRow = rowMap.get(sel[0].node.id)!;
      for (const r of displacedRows) listEl.insertBefore(r, firstGroupRow);
      const cc = ctx.childrenCache.get(parentId);
      if (cc) { const order = new Map(sibs.map((n, i) => [n.node.id, i])); cc.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)); }
      updateSelectionHighlight();
      if (parentId !== null) void apiMoveNode(ctx.gId, sel[0].node.id, parentId, direction, sibs.map(n => n.node.id));
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

  const doAddSibling = async (onode: ONode) => {
    const tempId = `temp-${++ctx.tempNodeCounter}`;
    const tempNode: ExplorerNode = { id: tempId };
    const sibs = getSiblings(onode);
    const idx = sibs.indexOf(onode);
    const no = make(tempNode, onode.parentId, onode.depth);
    no.childrenLoaded = true;
    sibs.splice(idx + 1, 0, no);
    const anchor = lastDescRow(onode);
    const newRow = buildRow(no);
    anchor.insertAdjacentElement('afterend', newRow);
    focusRow(no);

    const nn = await apiCreateNode(ctx.gId, onode.parentId, ctx.state.lang, '', onode.node.id);
    if (!nn) {
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

    const cc = ctx.childrenCache.get(onode.parentId);
    if (cc) { const ci = cc.findIndex(n => n.id === onode.node.id); if (ci >= 0) cc.splice(ci + 1, 0, nn); }
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
        const neighborRow = rowMap.get(neighbor.node.id)!;
        for (const r of group) listEl.insertBefore(r, neighborRow);
      } else {
        const anchor = lastDescRow(neighbor);
        let insertAfter = anchor;
        for (const r of group) { insertAfter.insertAdjacentElement('afterend', r); insertAfter = r; }
      }
      focusRow(onode);
      if (onode.parentId === null) void apiMoveBookmark(ctx.gId, onode.node.id, direction);
      else void apiMoveNode(ctx.gId, onode.node.id, onode.parentId, direction, sibs.map(n => n.node.id));
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

  const load = async () => {
    byId.clear();
    zoomStack.splice(0);
    baseDepth = 0;
    updateBreadcrumb();

    // Load color palette, property key colors, and key order (parallel, best-effort)
    if (ctx.colorPalette.size === 0) {
      const [palette, propColors, savedOrder] = await Promise.all([
        fetchColors(ctx.gId),
        fetchPropertyColors(ctx.gId),
        fetchPropertyOrder(ctx.gId),
      ]);
      ctx.colorPalette.clear();
      for (const { id, code } of palette) ctx.colorPalette.set(id, code);
      ctx.allPropColors.clear();
      for (const [key, val] of Object.entries(propColors)) ctx.allPropColors.set(key, val);
      keyOrder = savedOrder.filter(k => k.length > 0);
    }

    // Pane-specific parent override
    if (paneParentSet) {
      if (paneParentId !== null) {
        let cached = ctx.childrenCache.get(paneParentId);
        if (!cached) {
          cached = await fetchChildren(ctx.gId, paneParentId, ctx.limit);
          ctx.childrenCache.set(paneParentId, cached);
        }
        seedPropStore(cached);
        roots = cached.map(n => make(n, paneParentId, 0));
      } else {
        roots = [];
      }
      render();
      return;
    }

    let topNodes: ExplorerNode[];
    let parentId: string | null;

    if (ctx.rootNodeId) {
      // Use same cache key (null) as column view so both views share the same root node list
      let cached = ctx.childrenCache.get(null);
      if (!cached) {
        cached = await fetchChildren(ctx.gId, ctx.rootNodeId, ctx.limit);
        ctx.childrenCache.set(null, cached);
      }
      seedPropStore(cached);
      topNodes = cached; parentId = ctx.rootNodeId;
    } else {
      if (ctx.state.bookmarks.size === 0) {
        const ids = await fetchBookmarks(ctx.gId);
        ctx.state.bookmarks = new Set(ids);
      }
      const lang = ctx.state.showFallback ? undefined : ctx.state.lang;
      const { nodes } = await fetchBookmarkedNodes(ctx.gId, [...ctx.state.bookmarks], lang);
      seedPropStore(nodes);
      topNodes = nodes; parentId = null;
    }

    roots = topNodes.map(n => make(n, parentId, 0));
    render();
  };

  const setParent = async (nodeId: string | null) => {
    paneParentSet = true;
    paneParentId = nodeId;
    paneSelectedId = null;
    byId.clear();
    zoomStack.splice(0);
    baseDepth = 0;
    updateBreadcrumb();
    if (nodeId !== null) {
      let cached = ctx.childrenCache.get(nodeId);
      if (!cached) {
        cached = await fetchChildren(ctx.gId, nodeId, ctx.limit);
        ctx.childrenCache.set(nodeId, cached);
      }
      seedPropStore(cached);
      roots = cached.map(n => make(n, nodeId, 0));
    } else {
      roots = [];
    }
    render();
  };

  const getSelectedId = () => paneSelectedId;
  const setPaneFilterKeys = (keys: Set<string>) => { paneFilterKeys = keys; render(); };

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
  return { el, filterBtn, load, refresh: render, search, setParent, getSelectedId, setPaneFilterKeys };
}
