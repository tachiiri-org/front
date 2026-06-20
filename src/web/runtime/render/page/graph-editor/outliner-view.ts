import type { ExplorerNode, GraphEditorContext } from './types';
import { TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG, primaryLabel, fallbackLabel } from './constants';
import { fetchChildren, fetchBookmarks, fetchBookmarkedNodes, apiCreateNode, apiUpdateNode, apiDeleteNode } from './api';

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
  let focusedId: string | null = null;
  const byId = new Map<string, ONode>();

  const make = (node: ExplorerNode, parentId: string | null, depth: number): ONode => {
    const o: ONode = { node, parentId, depth, expanded: false, childrenLoaded: false, children: [] };
    byId.set(node.id, o);
    return o;
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

  const ensureChildren = async (onode: ONode) => {
    if (onode.childrenLoaded) return;
    let cached = ctx.childrenCache.get(onode.node.id);
    if (!cached) {
      cached = await fetchChildren(ctx.gId, onode.node.id, ctx.limit);
      ctx.childrenCache.set(onode.node.id, cached);
    }
    onode.children = cached.map(c => make(c, onode.node.id, onode.depth + 1));
    onode.childrenLoaded = true;
  };

  const buildRow = (onode: ONode): HTMLElement => {
    const row = document.createElement('div');
    row.dataset.nodeId = onode.node.id;
    row.style.cssText = `display:flex;align-items:flex-start;padding:1px 0;${focusedId === onode.node.id ? `background:${SELECT_STRONG}22;` : ''}`;

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
      btn.addEventListener('click', async () => {
        await ensureChildren(onode);
        onode.expanded = !onode.expanded;
        render();
        restoreFocus();
      });
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
      focusedId = onode.node.id;
      row.style.background = `${SELECT_STRONG}22`;
    });

    ta.addEventListener('blur', () => {
      row.style.background = '';
      const old = primaryLabel(onode.node, ctx.state.lang) ?? fallbackLabel(onode.node, ctx.state.lang);
      if (ta.value !== old) {
        void apiUpdateNode(ctx.gId, onode.node.id, ctx.state.lang, ta.value).then(() => {
          if (ctx.state.lang === 'en') onode.node.en = ta.value;
          else onode.node.ja = ta.value;
          // keep childrenCache in sync
          const cc = ctx.childrenCache.get(onode.parentId);
          const cn = cc?.find(n => n.id === onode.node.id);
          if (cn) { if (ctx.state.lang === 'en') cn.en = ta.value; else cn.ja = ta.value; }
        });
      }
    });

    ta.addEventListener('keydown', (e) => {
      const vis = flatVisible();
      const i = vis.indexOf(onode);

      if (e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        if (ta.selectionStart !== 0) return;
        e.preventDefault();
        if (i > 0) focusRow(vis[i - 1]);
      } else if (e.key === 'ArrowDown' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        if (ta.selectionStart !== ta.value.length) return;
        e.preventDefault();
        if (i < vis.length - 1) focusRow(vis[i + 1]);
      } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void doAddSibling(onode);
      } else if (e.key === 'Backspace' && ta.value === '') {
        e.preventDefault();
        void doDelete(onode, i, vis);
      }
    });

    row.appendChild(ta);
    return row;
  };

  const restoreFocus = () => {
    if (!focusedId) return;
    el.querySelector<HTMLTextAreaElement>(`[data-node-id="${focusedId}"] textarea`)?.focus();
  };

  const focusRow = (onode: ONode) => {
    focusedId = onode.node.id;
    el.querySelector<HTMLTextAreaElement>(`[data-node-id="${onode.node.id}"] textarea`)?.focus();
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
    // keep childrenCache in sync
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
    // keep childrenCache in sync
    const cc = ctx.childrenCache.get(onode.parentId);
    if (cc) { const ci = cc.findIndex(n => n.id === onode.node.id); if (ci >= 0) cc.splice(ci, 1); }
    render();
    const target = vis[visIdx - 1] ?? vis[visIdx + 1];
    if (target && byId.has(target.node.id)) focusRow(target);
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
