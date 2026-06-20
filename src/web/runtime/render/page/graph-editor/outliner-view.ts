import type { ExplorerNode, GraphEditorContext } from './types';
import { TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG, primaryLabel, fallbackLabel } from './constants';
import { fetchChildren, fetchBookmarks, fetchBookmarkedNodes, apiCreateNode, apiUpdateNode, apiDeleteNode, apiMoveNode, apiMoveBookmark } from './api';

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
} {
  const el = document.createElement('div');
  el.style.cssText = `flex:1;overflow-y:auto;overflow-x:hidden;padding:4px 0;`;

  let roots: ONode[] = [];
  const byId = new Map<string, ONode>();

  const make = (node: ExplorerNode, parentId: string | null, depth: number): ONode => {
    const o: ONode = { node, parentId, depth, expanded: false, childrenLoaded: false, children: [] };
    byId.set(node.id, o);
    return o;
  };

  const ancestorIds = (onode: ONode): Set<string> => {
    const ids = new Set<string>();
    let cur: ONode | undefined = onode;
    while (cur?.parentId != null) {
      ids.add(cur.parentId);
      cur = byId.get(cur.parentId);
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

  const render = () => {
    el.innerHTML = '';
    for (const o of flatVisible()) el.appendChild(buildRow(o));
  };

  const focusRow = (onode: ONode) => {
    el.querySelector<HTMLTextAreaElement>(`[data-node-id="${onode.node.id}"] textarea`)?.focus();
  };

  const ensureChildren = async (onode: ONode) => {
    if (onode.childrenLoaded) return;
    let cached = ctx.childrenCache.get(onode.node.id);
    if (!cached) {
      cached = await fetchChildren(ctx.gId, onode.node.id, ctx.limit);
      ctx.childrenCache.set(onode.node.id, cached);
    }
    const exclude = ancestorIds(onode);
    exclude.add(onode.node.id);
    onode.children = cached
      .filter(c => !exclude.has(c.id))
      .map(c => make(c, onode.node.id, onode.depth + 1));
    onode.childrenLoaded = true;
  };

  const toggleExpand = async (onode: ONode, forceExpand?: boolean) => {
    const next = forceExpand !== undefined ? forceExpand : !onode.expanded;
    if (next && !onode.childrenLoaded) await ensureChildren(onode);
    onode.expanded = next;
    render();
    focusRow(onode); // re-focus the same node after render
  };

  const buildRow = (onode: ONode): HTMLElement => {
    const row = document.createElement('div');
    row.dataset.nodeId = onode.node.id;
    row.style.cssText = `display:flex;align-items:flex-start;padding:1px 0;`;

    // Indent spacer
    const spacer = document.createElement('span');
    spacer.style.cssText = `flex-shrink:0;width:${onode.depth * 20 + 6}px;`;
    row.appendChild(spacer);

    // Expand/collapse toggle
    const btn = document.createElement('button');
    btn.style.cssText = `flex-shrink:0;width:18px;height:20px;background:transparent;border:none;padding:0;font-size:10px;line-height:1;`;
    const knownLen = onode.childrenLoaded
      ? onode.children.length
      : ctx.childrenCache.get(onode.node.id)?.length;
    if (knownLen === 0) {
      btn.textContent = '·';
      btn.style.color = TEXT_DIM;
      btn.style.cursor = 'default';
    } else {
      btn.textContent = onode.expanded ? '▾' : '▸';
      btn.style.color = TEXT_MID;
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', () => void toggleExpand(onode));
    }
    row.appendChild(btn);

    // Editable label
    const label = primaryLabel(onode.node, ctx.state.lang) ?? fallbackLabel(onode.node, ctx.state.lang);
    const ta = document.createElement('textarea');
    ta.value = label;
    ta.style.cssText = `flex:1;background:transparent;border:none;outline:none;resize:none;font-size:13px;font-family:inherit;line-height:1.5;padding:0 4px 0 0;overflow:hidden;min-height:20px;color:${onode.node.color ?? TEXT_HIGH};`;
    ta.rows = 1;

    const resize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    requestAnimationFrame(resize);
    ta.addEventListener('input', resize);

    ta.addEventListener('focus', () => {
      row.style.background = `${SELECT_STRONG}22`;
    });

    ta.addEventListener('blur', () => {
      row.style.background = '';
      const old = primaryLabel(onode.node, ctx.state.lang) ?? fallbackLabel(onode.node, ctx.state.lang);
      const newVal = ta.value;
      if (newVal !== old) {
        // Optimistic: update onode.node immediately so render() uses the new value
        if (ctx.state.lang === 'en') onode.node.en = newVal;
        else onode.node.ja = newVal;
        const cc = ctx.childrenCache.get(onode.parentId);
        const cn = cc?.find(n => n.id === onode.node.id);
        if (cn) { if (ctx.state.lang === 'en') cn.en = newVal; else cn.ja = newVal; }
        void apiUpdateNode(ctx.gId, onode.node.id, ctx.state.lang, newVal);
      }
    });

    ta.addEventListener('keydown', (e) => {
      const vis = flatVisible();
      const i = vis.indexOf(onode);

      // Ctrl/Cmd+↓ : expand, Ctrl/Cmd+↑ : collapse
      if (e.key === 'ArrowDown' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        void toggleExpand(onode, true);
        return;
      }
      if (e.key === 'ArrowUp' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        void toggleExpand(onode, false);
        return;
      }

      // Shift+Alt+↑↓ : reorder node (same as column view)
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && e.altKey) {
        e.preventDefault();
        void doMove(onode, e.key === 'ArrowUp' ? 'up' : 'down');
        return;
      }

      // ↑ at start → focus previous node
      if (e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (ta.selectionStart !== 0) return;
        e.preventDefault();
        if (i > 0) focusRow(vis[i - 1]);
      // ↓ at end → focus next node
      } else if (e.key === 'ArrowDown' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (ta.selectionStart !== ta.value.length) return;
        e.preventDefault();
        if (i < vis.length - 1) focusRow(vis[i + 1]);
      // Enter → add sibling node
      } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void doAddSibling(onode);
      // Backspace on empty → delete node
      } else if (e.key === 'Backspace' && ta.value === '') {
        e.preventDefault();
        void doDelete(onode, i, vis);
      }
    });

    row.appendChild(ta);
    return row;
  };

  const getSiblings = (onode: ONode): ONode[] =>
    onode.parentId === null ? roots : (byId.get(onode.parentId)?.children ?? roots);

  const doAddSibling = async (onode: ONode) => {
    const nn = await apiCreateNode(ctx.gId, onode.parentId, ctx.state.lang, '', onode.node.id);
    if (!nn) return;
    const sibs = getSiblings(onode);
    const idx = sibs.indexOf(onode);
    const no = make(nn, onode.parentId, onode.depth);
    no.childrenLoaded = true;
    sibs.splice(idx + 1, 0, no);
    const cc = ctx.childrenCache.get(onode.parentId);
    if (cc) { const ci = cc.findIndex(n => n.id === onode.node.id); cc.splice(ci + 1, 0, nn); }
    render();
    focusRow(no);
  };

  const doDelete = async (onode: ONode, visIdx: number, vis: ONode[]) => {
    await apiDeleteNode(ctx.gId, onode.node.id);
    const sibs = getSiblings(onode);
    sibs.splice(sibs.indexOf(onode), 1);
    byId.delete(onode.node.id);
    const cc = ctx.childrenCache.get(onode.parentId);
    if (cc) { const ci = cc.findIndex(n => n.id === onode.node.id); if (ci >= 0) cc.splice(ci, 1); }
    render();
    const target = vis[visIdx - 1] ?? vis[visIdx + 1];
    if (target && byId.has(target.node.id)) focusRow(target);
  };

  const doMove = async (onode: ONode, direction: 'up' | 'down') => {
    const sibs = getSiblings(onode);
    const idx = sibs.indexOf(onode);
    const newIdx = idx + (direction === 'up' ? -1 : 1);
    if (newIdx < 0 || newIdx >= sibs.length) return;

    // Optimistic local reorder
    sibs.splice(idx, 1);
    sibs.splice(newIdx, 0, onode);

    // Sync childrenCache order
    const cc = ctx.childrenCache.get(onode.parentId);
    if (cc) {
      const ci = cc.findIndex(n => n.id === onode.node.id);
      if (ci >= 0) {
        cc.splice(ci, 1);
        cc.splice(newIdx, 0, onode.node);
      }
    }

    render();
    focusRow(onode);

    if (onode.parentId === null) {
      void apiMoveBookmark(ctx.gId, onode.node.id, direction);
    } else {
      const afterSwapSiblingIds = sibs.map(n => n.node.id);
      void apiMoveNode(ctx.gId, onode.node.id, onode.parentId, direction, afterSwapSiblingIds);
    }
  };

  const load = async () => {
    byId.clear();
    let topNodes: ExplorerNode[];
    let parentId: string | null;

    if (ctx.rootNodeId) {
      let cached = ctx.childrenCache.get(ctx.rootNodeId);
      if (!cached) {
        cached = await fetchChildren(ctx.gId, ctx.rootNodeId, ctx.limit);
        ctx.childrenCache.set(ctx.rootNodeId, cached);
      }
      topNodes = cached;
      parentId = ctx.rootNodeId;
    } else {
      if (ctx.state.bookmarks.size === 0) {
        const ids = await fetchBookmarks(ctx.gId);
        ctx.state.bookmarks = new Set(ids);
      }
      const lang = ctx.state.showFallback ? undefined : ctx.state.lang;
      const { nodes } = await fetchBookmarkedNodes(ctx.gId, [...ctx.state.bookmarks], lang);
      topNodes = nodes;
      parentId = null;
    }

    roots = topNodes.map(n => make(n, parentId, 0));
    render();
  };

  return { el, load, refresh: render };
}
