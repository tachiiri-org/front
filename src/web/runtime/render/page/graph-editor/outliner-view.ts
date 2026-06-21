import type { ExplorerNode, GraphEditorContext } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, primaryLabel, fallbackLabel } from './constants';
import {
  fetchChildren, fetchBookmarks, fetchBookmarkedNodes, fetchAllNodes,
  apiCreateNode, apiUpdateNode, apiDeleteNode, apiMoveNode, apiMoveBookmark, apiToggleLink,
  apiSetProperty, apiRemoveProperty,
  fetchColors, fetchPropertyColors, apiSetPropertyColor, apiRemovePropertyColor,
} from './api';

type ONode = {
  node: ExplorerNode;
  parentId: string | null;
  depth: number;
  expanded: boolean;
  childrenLoaded: boolean;
  children: ONode[];
};

export function createOutlinerView(ctx: GraphEditorContext): {
  el: HTMLElement;
  load: () => Promise<void>;
  refresh: () => void;
  search: (query: string) => Promise<void>;
} {
  // Outer wrapper (returned as el)
  const el = document.createElement('div');
  el.style.cssText = `flex:1;display:flex;flex-direction:column;overflow:hidden;`;

  // Breadcrumb bar (always visible)
  const bcEl = document.createElement('div');
  bcEl.style.cssText = `display:flex;flex-shrink:0;align-items:center;gap:2px;flex-wrap:wrap;padding:4px 8px 4px 10px;border-bottom:1px solid ${BORDER};font-size:12px;`;
  el.appendChild(bcEl);

  // Property filter bar
  let filterKey = '';
  let filterValue = '';

  const filterEl = document.createElement('div');
  filterEl.style.cssText = `display:flex;align-items:center;gap:6px;padding:3px 8px 3px 10px;border-bottom:1px solid ${BORDER};flex-shrink:0;`;

  const filterLabel = document.createElement('span');
  filterLabel.textContent = 'filter';
  filterLabel.style.cssText = `color:${TEXT_DIM};font-size:11px;flex-shrink:0;`;

  // Single input: "例外" → key="例外", "key=val" → key+value match
  const filterIn = document.createElement('input');
  filterIn.placeholder = '例外 または key=value';
  filterIn.style.cssText = `flex:1;background:transparent;border:none;border-bottom:1px solid ${BORDER};padding:1px 2px;color:${TEXT_HIGH};font-size:12px;outline:none;font-family:inherit;`;

  const filterCount = document.createElement('span');
  filterCount.style.cssText = `color:${TEXT_DIM};font-size:11px;flex-shrink:0;`;

  const filterClearBtn = document.createElement('button');
  filterClearBtn.textContent = '×';
  filterClearBtn.title = 'フィルタをクリア';
  filterClearBtn.style.cssText = `background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:13px;padding:0 2px;display:none;flex-shrink:0;`;

  filterEl.append(filterLabel, filterIn, filterCount, filterClearBtn);
  el.appendChild(filterEl);

  const applyFilter = () => {
    const raw = filterIn.value.trim();
    const eqIdx = raw.indexOf('=');
    filterKey = eqIdx >= 0 ? raw.slice(0, eqIdx).trim() : raw;
    filterValue = eqIdx >= 0 ? raw.slice(eqIdx + 1).trim() : '';
    filterClearBtn.style.display = raw ? '' : 'none';
    render();
  };

  filterIn.addEventListener('input', applyFilter);
  filterClearBtn.addEventListener('click', () => {
    filterIn.value = ''; filterKey = ''; filterValue = '';
    filterClearBtn.style.display = 'none';
    render();
  });

  // Scrollable list
  const listEl = document.createElement('div');
  listEl.dataset.outlinerList = '1';
  listEl.style.cssText = `flex:1;overflow-y:auto;overflow-x:hidden;padding:4px 0 4px 10px;`;
  el.appendChild(listEl);

  let roots: ONode[] = [];
  let baseDepth = 0; // depth of current root level (for relative indent display)
  const byId = new Map<string, ONode>();
  const rowMap = new Map<string, HTMLElement>();

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
    if (filterKey || filterValue) {
      const matched: ONode[] = [];
      byId.forEach(o => {
        const props = o.node.properties ?? {};
        // key only: node has that key (any value)
        // key=value: exact match
        const ok = filterKey && filterValue
          ? props[filterKey] === filterValue
          : filterKey
            ? props[filterKey] !== undefined
            : Object.values(props).includes(filterValue);
        if (ok) matched.push(o);
      });
      filterCount.textContent = `${matched.length}件`;
      for (const o of matched) listEl.appendChild(buildRow(o));
    } else {
      filterCount.textContent = '';
      for (const o of flatVisible()) listEl.appendChild(buildRow(o));
    }
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
    const filled = hasChildren && !onode.expanded;
    if (propColor) {
      m.style.background = propColor;
      m.style.border = 'none';
    } else {
      m.style.background = filled ? TEXT_MID : 'transparent';
      m.style.border = filled ? 'none' : `1.5px solid ${hasChildren ? TEXT_MID : TEXT_DIM}`;
    }
    const wrap = m.parentElement;
    if (wrap) wrap.style.cursor = hasChildren ? 'pointer' : 'default';
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
  const buildRow = (onode: ONode): HTMLElement => {
    const row = document.createElement('div');
    row.dataset.nodeId = onode.node.id;
    row.style.cssText = `display:flex;align-items:stretch;padding:1px 0;`;
    rowMap.set(onode.node.id, row);

    const spacer = document.createElement('span');
    spacer.style.cssText = `flex-shrink:0;width:${(onode.depth - baseDepth) * 20 + 6}px;`;
    row.appendChild(spacer);

    const btnWrap = document.createElement('span');
    btnWrap.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;`;
    btnWrap.addEventListener('click', () => void toggleExpand(onode));
    const marker = document.createElement('span');
    marker.dataset.expandMarker = '1';
    marker.style.cssText = `width:7px;height:7px;border-radius:1px;box-sizing:border-box;pointer-events:none;`;
    btnWrap.appendChild(marker);
    btnWrap.addEventListener('contextmenu', (e) => { e.preventDefault(); showPropertyMenu(onode, e.clientX, e.clientY); });
    row.appendChild(btnWrap);
    updateExpandMarker(onode);

    const label = primaryLabel(onode.node, ctx.state.lang) ?? fallbackLabel(onode.node, ctx.state.lang);
    const ta = document.createElement('textarea');
    ta.value = label;
    ta.style.cssText = `flex:1;background:transparent;border:none;outline:none;resize:none;font-size:15px;font-family:inherit;line-height:1.8;padding:0 4px 0 0;overflow:hidden;min-height:20px;color:${onode.node.color ?? TEXT_HIGH};`;
    ta.rows = 1;

    const resize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    requestAnimationFrame(resize);
    ta.addEventListener('input', resize);

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

    row.appendChild(ta);
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
    for (const k of Object.keys(props)) ctx.allPropKeys.add(k);
    // Also sync to ExplorerNode instances already in memory
    ctx.childrenCache.forEach(nodes => {
      for (const n of nodes) { if (n.id === nodeId) n.properties = { ...props }; }
    });
    const o = byId.get(nodeId);
    if (o) o.node.properties = { ...props };
  };

  const showPropertyMenu = (onode: ONode, x: number, y: number) => {
    document.querySelector('[data-prop-menu]')?.remove();

    const menu = document.createElement('div');
    menu.dataset.propMenu = '1';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:100;min-width:220px;background:hsl(240,14%,9%);border:1px solid ${BORDER};border-radius:6px;padding:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.4);`;

    // Color picker popover for a property key
    const showColorPicker = (key: string, anchorEl: HTMLElement) => {
      document.querySelector('[data-color-picker]')?.remove();
      const picker = document.createElement('div');
      picker.dataset.colorPicker = '1';
      picker.style.cssText = `position:fixed;z-index:101;background:hsl(240,14%,12%);border:1px solid ${BORDER};border-radius:6px;padding:6px;display:grid;grid-template-columns:repeat(6,1fr);gap:4px;box-shadow:0 4px 12px rgba(0,0,0,.5);`;
      const anchorRect = anchorEl.getBoundingClientRect();
      picker.style.left = `${anchorRect.left}px`;
      picker.style.top = `${anchorRect.bottom + 4}px`;

      const current = ctx.allPropColors.get(key)?.colorId;
      // "no color" button
      const noneBtn = document.createElement('button');
      noneBtn.title = '色なし';
      noneBtn.style.cssText = `width:20px;height:20px;border-radius:4px;border:1.5px solid ${BORDER};background:transparent;cursor:pointer;grid-column:span 2;font-size:10px;color:${TEXT_DIM};`;
      noneBtn.textContent = '×';
      noneBtn.addEventListener('click', () => {
        ctx.allPropColors.delete(key);
        void apiRemovePropertyColor(ctx.gId, key);
        picker.remove();
        rebuild();
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
          rebuild();
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

    const rebuild = () => {
      menu.innerHTML = '';

      const title = document.createElement('div');
      title.textContent = 'プロパティ';
      title.style.cssText = `color:${TEXT_DIM};font-size:11px;margin-bottom:6px;letter-spacing:.05em;`;
      menu.appendChild(title);

      const nodeProps = ctx.propStore.get(onode.node.id) ?? {};

      // All globally known keys: checkbox on left, color swatch on right
      for (const key of ctx.allPropKeys) {
        const assigned = key in nodeProps;
        const propColor = ctx.allPropColors.get(key);

        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:6px;margin-bottom:4px;`;

        // Checkbox
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = assigned;
        cb.style.cssText = `flex-shrink:0;cursor:pointer;`;
        cb.addEventListener('change', () => {
          if (cb.checked) {
            syncPropChange(onode.node.id, p => { p[key] = '●'; });
            void apiSetProperty(ctx.gId, onode.node.id, key, '●');
          } else {
            syncPropChange(onode.node.id, p => { delete p[key]; });
            void apiRemoveProperty(ctx.gId, onode.node.id, key);
          }
          updateExpandMarker(onode);
          rebuild();
        });

        const labelEl = document.createElement('span');
        labelEl.textContent = key;
        labelEl.style.cssText = `flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${assigned ? (propColor?.code ?? TEXT_HIGH) : TEXT_DIM};cursor:pointer;`;
        labelEl.addEventListener('click', () => { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); });

        // Color swatch button
        const swatch = document.createElement('button');
        swatch.style.cssText = `flex-shrink:0;width:14px;height:14px;border-radius:3px;border:1px solid ${BORDER};background:${propColor?.code ?? TEXT_DIM};cursor:pointer;`;
        swatch.addEventListener('click', (e) => { e.stopPropagation(); showColorPicker(key, swatch); });

        row.append(cb, labelEl, swatch);
        menu.appendChild(row);
      }

      const divider = document.createElement('div');
      divider.style.cssText = `border-top:1px solid ${BORDER};margin:6px 0;`;
      menu.appendChild(divider);

      // New key input
      const addRow = document.createElement('div');
      addRow.style.cssText = `display:flex;align-items:center;gap:4px;`;

      const propIn = document.createElement('input');
      propIn.placeholder = '新しいキー';
      propIn.style.cssText = `flex:1;background:transparent;border:1px solid ${BORDER};border-radius:3px;padding:3px 5px;color:${TEXT_HIGH};font-size:12px;outline:none;font-family:inherit;min-width:0;`;

      const addBtn = document.createElement('button');
      addBtn.textContent = '+';
      addBtn.style.cssText = `background:transparent;border:1px solid ${BORDER};border-radius:3px;color:${TEXT_MID};cursor:pointer;padding:2px 7px;font-size:13px;flex-shrink:0;`;

      const doAdd = () => {
        const k = propIn.value.trim(); if (!k) return;
        ctx.allPropKeys.add(k);
        syncPropChange(onode.node.id, p => { p[k] = '●'; });
        void apiSetProperty(ctx.gId, onode.node.id, k, '●');
        propIn.value = '';
        rebuild();
      };
      addBtn.addEventListener('click', doAdd);
      propIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });

      addRow.append(propIn, addBtn);
      menu.appendChild(addRow);
    };

    rebuild();
    document.body.appendChild(menu);

    // Reposition if off-screen
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth) menu.style.left = `${window.innerWidth - r.width - 8}px`;
      if (r.bottom > window.innerHeight) menu.style.top = `${y - r.height}px`;
    });

    const onOutside = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener('mousedown', onOutside); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { menu.remove(); document.removeEventListener('keydown', onKey); }
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
        for (const k of Object.keys(n.properties)) ctx.allPropKeys.add(k);
      }
    }
  };

  const load = async () => {
    byId.clear();
    zoomStack.splice(0);
    baseDepth = 0;
    updateBreadcrumb();

    // Load color palette and property key colors (parallel, best-effort)
    if (ctx.colorPalette.size === 0) {
      const [palette, propColors] = await Promise.all([
        fetchColors(ctx.gId),
        fetchPropertyColors(ctx.gId),
      ]);
      ctx.colorPalette.clear();
      for (const { id, code } of palette) ctx.colorPalette.set(id, code);
      ctx.allPropColors.clear();
      for (const [key, val] of Object.entries(propColors)) ctx.allPropColors.set(key, val);
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
  return { el, load, refresh: render, search };
}
