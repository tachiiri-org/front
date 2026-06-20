import type { ExplorerNode, GraphEditorContext } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, primaryLabel, fallbackLabel } from './constants';
import {
  fetchChildren, fetchBookmarks, fetchBookmarkedNodes, fetchAllNodes,
  apiCreateNode, apiUpdateNode, apiDeleteNode, apiMoveNode, apiMoveBookmark, apiToggleLink,
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

  // Scrollable list
  const listEl = document.createElement('div');
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
    for (const o of flatVisible()) listEl.appendChild(buildRow(o));
    updateSelectionHighlight();
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
    const excl = ancestorIds(onode); excl.add(onode.node.id);
    onode.children = cached.filter(c => !excl.has(c.id)).map(c => make(c, onode.node.id, onode.depth + 1));
    onode.childrenLoaded = true;
  };

  const updateExpandMarker = (onode: ONode) => {
    const row = rowMap.get(onode.node.id);
    if (!row) return;
    const m = row.querySelector<HTMLElement>('[data-expand-marker]');
    if (!m) return;
    const hasChildren = onode.childrenLoaded
      ? onode.children.length > 0
      : (ctx.childrenCache.get(onode.node.id)?.length ?? 1) > 0;
    const filled = hasChildren && !onode.expanded;
    m.style.background = filled ? TEXT_MID : 'transparent';
    m.style.border = filled ? 'none' : `1.5px solid ${hasChildren ? TEXT_MID : TEXT_DIM}`;
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

  const toggleExpand = async (onode: ONode, forceExpand?: boolean) => {
    const next = forceExpand !== undefined ? forceExpand : !onode.expanded;
    if (next === onode.expanded) { focusRow(onode); return; }
    if (next && !onode.childrenLoaded) await ensureChildren(onode);
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
        if (isMultiSelect()) doMoveMulti(e.key === 'ArrowUp' ? 'up' : 'down');
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

  const doMoveMulti = (direction: 'up' | 'down') => {
    const sel = getSelectedONodes();
    if (sel.length <= 1) return;
    const parentId = sel[0].parentId;
    if (!sel.every(n => n.parentId === parentId)) return;
    const sibs = getSiblings(sel[0]);
    const minIdx = Math.min(...sel.map(n => sibs.indexOf(n)));
    const maxIdx = Math.max(...sel.map(n => sibs.indexOf(n)));
    if (direction === 'up') {
      if (minIdx === 0) return;
      const displaced = sibs[minIdx - 1];
      sibs.splice(minIdx - 1, 1); sibs.splice(maxIdx, 0, displaced);
      const displacedRows = visibleRowGroup(displaced);
      let anchor: HTMLElement = lastDescRow(sel[sel.length - 1]);
      for (const r of displacedRows) { anchor.insertAdjacentElement('afterend', r); anchor = r; }
    } else {
      if (maxIdx === sibs.length - 1) return;
      const displaced = sibs[maxIdx + 1];
      sibs.splice(maxIdx + 1, 1); sibs.splice(minIdx, 0, displaced);
      const displacedRows = visibleRowGroup(displaced);
      const firstGroupRow = rowMap.get(sel[0].node.id)!;
      for (const r of displacedRows) listEl.insertBefore(r, firstGroupRow);
    }
    const cc = ctx.childrenCache.get(parentId);
    if (cc) { const order = new Map(sibs.map((n, i) => [n.node.id, i])); cc.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)); }
    updateSelectionHighlight();
    if (parentId !== null) void apiMoveNode(ctx.gId, sel[0].node.id, parentId, direction, sibs.map(n => n.node.id));
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

  const load = async () => {
    byId.clear();
    zoomStack.splice(0);
    baseDepth = 0;
    updateBreadcrumb();

    let topNodes: ExplorerNode[];
    let parentId: string | null;

    if (ctx.rootNodeId) {
      // Use same cache key (null) as column view so both views share the same root node list
      let cached = ctx.childrenCache.get(null);
      if (!cached) {
        cached = await fetchChildren(ctx.gId, ctx.rootNodeId, ctx.limit);
        ctx.childrenCache.set(null, cached);
      }
      topNodes = cached; parentId = ctx.rootNodeId;
    } else {
      if (ctx.state.bookmarks.size === 0) {
        const ids = await fetchBookmarks(ctx.gId);
        ctx.state.bookmarks = new Set(ids);
      }
      const lang = ctx.state.showFallback ? undefined : ctx.state.lang;
      const { nodes } = await fetchBookmarkedNodes(ctx.gId, [...ctx.state.bookmarks], lang);
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
    roots = nodes.map(n => make(n, null, 0));
    render();
  };

  updateBreadcrumb(); // show "ルート" on initial render
  return { el, load, refresh: render, search };
}
