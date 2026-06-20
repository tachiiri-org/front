import type { ExplorerNode, GraphEditorContext } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG, primaryLabel } from './constants';
import {
  fetchAllNodes, fetchBookmarkedNodes, fetchChildren,
  apiCreateNode, apiAddBookmark, apiUpdateNode,
} from './api';

export function createColumnFns(ctx: GraphEditorContext): {
  loadColumn: GraphEditorContext['loadColumn'];
  rebuildAll: GraphEditorContext['rebuildAll'];
  appendColumn: GraphEditorContext['appendColumn'];
  buildColumnEl: GraphEditorContext['buildColumnEl'];
  onNodeFocus: GraphEditorContext['onNodeFocus'];
  refreshRowStyles: GraphEditorContext['refreshRowStyles'];
} {
  const rebuildAll = () => {
    ctx.columnsEl.innerHTML = '';
    for (let i = 0; i < ctx.state.columns.length; i++) {
      ctx.columnsEl.appendChild(buildColumnEl(i));
    }
    ctx.refreshAllMarkers();
    ctx.refreshAllNodeText();
  };

  const appendColumn = (colIndex: number) => {
    const existing = ctx.columnsEl.children;
    while (existing.length > colIndex) {
      ctx.columnsEl.removeChild(existing[existing.length - 1]);
    }
    ctx.columnsEl.appendChild(buildColumnEl(colIndex));
    ctx.refreshAllMarkers();
    ctx.refreshAllNodeText();
  };

  const fetchCached = async (parentId: string | null): Promise<{ nodes: ExplorerNode[]; hasMore: boolean }> => {
    if (parentId === null) {
      if (ctx.state.searchQuery) {
        const lang = ctx.state.showFallback ? undefined : ctx.state.lang;
        return fetchAllNodes(ctx.gId, [], 0, lang, undefined, ctx.state.searchQuery, 50);
      }
      if (ctx.childrenCache.has(null)) return { nodes: ctx.childrenCache.get(null)!, hasMore: false };
      const lang = ctx.state.showFallback ? undefined : ctx.state.lang;
      if (ctx.rootNodeId) {
        const nodes = await fetchChildren(ctx.gId, ctx.rootNodeId, ctx.limit);
        ctx.childrenCache.set(null, nodes);
        return { nodes, hasMore: false };
      }
      const result = await fetchBookmarkedNodes(ctx.gId, [...ctx.state.bookmarks], lang);
      ctx.childrenCache.set(null, result.nodes);
      return result;
    }
    if (ctx.childrenCache.has(parentId)) return { nodes: ctx.childrenCache.get(parentId)!, hasMore: false };
    const nodes = await fetchChildren(ctx.gId, parentId, ctx.limit);
    ctx.childrenCache.set(parentId, nodes);
    return { nodes, hasMore: false };
  };

  // 列が表示されたら、その列の各ノードの子を先読みしてキャッシュ
  const prefetchChildren = (nodeIds: string[]): void => {
    const toFetch = nodeIds.filter((id) => !ctx.childrenCache.has(id)).slice(0, 20);
    for (const nodeId of toFetch) {
      void fetchChildren(ctx.gId, nodeId, ctx.limit).then((nodes) => {
        ctx.childrenCache.set(nodeId, nodes);
        // Update count badge in col 0 if visible
        const badge = ctx.columnsEl.querySelector<HTMLElement>(`[data-count-for="${nodeId}"]`);
        if (badge) badge.textContent = nodes.length > 0 ? String(nodes.length) : '';
      });
    }
  };

  // parentId=null means "load all nodes" (column 0)
  const loadColumn = async (parentId: string | null, colIndex: number) => {
    const version = ++ctx.columnVersion;
    ctx.state.columns = ctx.state.columns.slice(0, colIndex);

    // Cache hit: render immediately (skip for col 0 when search is active — results are never cached)
    if (ctx.childrenCache.has(parentId) && !(parentId === null && ctx.state.searchQuery)) {
      const cached = ctx.childrenCache.get(parentId)!;
      ctx.state.columns.push({ parentId, nodes: cached, loading: false, selectedId: null, hasMore: false, nextOffset: cached.length });
      appendColumn(colIndex);
      prefetchChildren(cached.map((n) => n.id));
      return;
    }

    // Cache miss: render empty column (loading indicator 非表示), then fetch
    ctx.state.columns.push({ parentId, nodes: [], loading: true, selectedId: null, hasMore: false, nextOffset: 0 });
    appendColumn(colIndex);

    const { nodes, hasMore } = await fetchCached(parentId);
    if (version !== ctx.columnVersion) return;
    if (ctx.state.columns[colIndex]) {
      ctx.state.columns[colIndex].nodes = nodes;
      ctx.state.columns[colIndex].loading = false;
      ctx.state.columns[colIndex].hasMore = hasMore;
      ctx.state.columns[colIndex].nextOffset = nodes.length;
    }
    const colEl = ctx.columnsEl.children[colIndex] as HTMLElement | undefined;
    if (colEl) {
      ctx.columnsEl.replaceChild(buildColumnEl(colIndex), colEl);
      ctx.refreshAllMarkers();
      ctx.refreshAllNodeText();
    }
    prefetchChildren(nodes.map((n) => n.id));
  };

  const onNodeFocus = (colIndex: number, nodeId: string) => {
    if (ctx.state.columns[colIndex]?.selectedId === nodeId) return;
    if (ctx.state.columns[colIndex]) ctx.state.columns[colIndex].selectedId = nodeId;
    void loadColumn(nodeId, colIndex + 1);
    refreshRowStyles(colIndex);
    ctx.refreshBreadcrumb();
  };

  const refreshRowStyles = (colIndex: number) => {
    const colEl = ctx.columnsEl.children[colIndex];
    if (!colEl) return;
    const selectedId = ctx.state.columns[colIndex]?.selectedId;
    colEl.querySelectorAll<HTMLElement>('[data-node-id]:not(textarea)').forEach((row) => {
      const isSelected = row.dataset.nodeId === selectedId;
      row.style.background = 'transparent';
      row.style.borderLeft = `2px solid ${isSelected ? SELECT_STRONG : 'transparent'}`;
    });
  };

  const buildColumnEl = (colIndex: number): HTMLElement => {
    const col = ctx.state.columns[colIndex];

    const colEl = document.createElement('div');
    colEl.dataset.colIndex = String(colIndex);
    colEl.style.cssText = `
      width:fit-content;max-width:40%;min-width:15vw;
      display:flex;flex-direction:column;
      border-right:1px solid ${BORDER};
      flex-shrink:0;overflow:hidden;
    `;

    // ── Item list ─────────────────────────────────────────────────
    const list = document.createElement('div');
    list.dataset.list = '1';
    list.style.cssText = `flex:1;overflow-y:auto;padding:4px 12px 4px 0;`;

    // Draft row — same structure as node rows
    const draftRow = document.createElement('div');
    draftRow.style.cssText = `display:flex;align-items:flex-start;gap:4px;padding:1px 8px 1px 8px;flex-shrink:0;background:transparent;border-left:2px solid transparent;`;
    const draftStar = document.createElement('span');
    draftStar.textContent = '☆';
    draftStar.style.cssText = `flex-shrink:0;align-self:center;font-size:10px;line-height:1;color:transparent;margin-top:1px;user-select:none;`;
    const draftMarker = document.createElement('span');
    draftMarker.style.cssText = `width:6px;height:6px;flex-shrink:0;align-self:center;border-radius:1px;box-sizing:border-box;background:transparent;border:1.5px solid ${TEXT_DIM};margin-top:1px;`;
    const draftInput = document.createElement('textarea');
    draftInput.rows = 1;
    Object.assign(draftInput.style, {
      display: 'block', width: '100%', border: 'none', outline: 'none', resize: 'none',
      overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit',
      padding: '2px 4px', boxSizing: 'border-box', background: 'transparent', color: TEXT_MID,
    });
    (draftInput.style as unknown as Record<string, string>)['field-sizing'] = 'content';
    draftInput.addEventListener('focus', () => { draftInput.style.color = TEXT_HIGH; });
    draftInput.addEventListener('blur', () => { draftInput.style.color = TEXT_MID; });
    draftInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      const val = draftInput.value.trim();
      if (!val) return;
      draftInput.value = '';
      ctx.childrenCache.delete(col.parentId);
      // Optimistic: add temp node to UI immediately
      const tempId = `temp-${++ctx.tempNodeCounter}`;
      const tempNode: ExplorerNode = { id: tempId, [ctx.state.lang]: val };
      const isRootCol = colIndex === 0 && !ctx.rootNodeId;
      if (ctx.state.columns[colIndex]) {
        ctx.state.columns[colIndex].nodes.push(tempNode);
        if (isRootCol) ctx.state.bookmarks.add(tempId);
        const tempRow = ctx.buildNodeRow(tempNode, colIndex);
        list.appendChild(tempRow);
        const newTa = tempRow.querySelector<HTMLTextAreaElement>('textarea');
        if (newTa) {
          newTa.focus();
          newTa.scrollIntoView({ block: 'nearest' });
        }
      }
      const createParentId = colIndex === 0 ? (ctx.rootNodeId ?? null) : col.parentId;
      const newNode = await apiCreateNode(ctx.gId, createParentId, ctx.state.lang, val);
      if (newNode && ctx.state.columns[colIndex]) {
        // Replace temp node with real node in-place
        const idx = ctx.state.columns[colIndex].nodes.indexOf(tempNode);
        if (idx !== -1) ctx.state.columns[colIndex].nodes[idx] = newNode;
        if (isRootCol) {
          ctx.state.bookmarks.delete(tempId);
          ctx.state.bookmarks.add(newNode.id);
          void apiAddBookmark(ctx.gId, newNode.id);
        }
        // Mutate tempNode so the row's event-listener closures pick up the real id.
        Object.assign(tempNode, newNode);
        // Update DOM: replace all data-node-id references from tempId to real id
        list.querySelectorAll<HTMLElement>(`[data-node-id="${tempId}"]`).forEach((el) => {
          el.dataset.nodeId = newNode.id;
        });
        // Flush any unsaved edits made while the API call was in-flight.
        const createdTextarea = list.querySelector<HTMLTextAreaElement>(`textarea[data-node-id="${newNode.id}"]`);
        if (createdTextarea?.value.trim()) {
          void apiUpdateNode(ctx.gId, newNode.id, ctx.state.lang, createdTextarea.value.trim());
        }
        if (ctx.state.linkSourceId === tempId) {
          void ctx.setLinkSource(newNode.id);
        }
        void ctx.onNodeFocus(colIndex, newNode.id);
      }
    });
    draftRow.appendChild(draftStar);
    draftRow.appendChild(draftMarker);
    draftRow.appendChild(draftInput);
    if (!(colIndex === 0 && ctx.state.searchQuery)) {
      list.appendChild(draftRow);
    }

    if (!col.loading) {
      // Filter out nodes that have no text in current lang but have text in other lang (when showFallback=false)
      const base = ctx.state.showFallback
        ? col.nodes
        : col.nodes.filter((n) => primaryLabel(n, ctx.state.lang) != null);
      // Collect all ancestor IDs to prevent loops in the undirected graph.
      // rootNodeId is always excluded (it is the nav root, not a content node).
      // All selectedIds in columns to the left are also excluded (they form the current navigation path).
      const ancestorIds = new Set<string>();
      if (ctx.rootNodeId) ancestorIds.add(ctx.rootNodeId);
      for (let i = 0; i < colIndex; i++) {
        const sel = ctx.state.columns[i]?.selectedId;
        if (sel) ancestorIds.add(sel);
      }
      // col 0: search results (all), rootNodeId children (all), or bookmarks only; col 1+: all base nodes
      const nodes = (colIndex === 0
        ? (ctx.state.searchQuery || ctx.rootNodeId
            ? base
            : base.filter((n) => ctx.state.bookmarks.has(n.id)))
        : base
      ).filter((n) => !ancestorIds.has(n.id) && n.id !== ctx.pendingDeleteId);
      for (const node of nodes) {
        list.appendChild(ctx.buildNodeRow(node, colIndex));
      }

      // "Load more" button for column 0 pagination — same flex structure as node rows
      if (colIndex === 0 && col.hasMore) {
        const moreBtnWrapper = document.createElement('div');
        moreBtnWrapper.style.cssText = `display:flex;align-items:flex-start;gap:4px;padding:1px 8px 1px 8px;flex-shrink:0;border-top:1px solid ${BORDER};`;

        const moreBtnStar = document.createElement('span');
        moreBtnStar.textContent = '☆';
        moreBtnStar.style.cssText = `flex-shrink:0;align-self:center;font-size:10px;line-height:1;color:transparent;margin-top:1px;user-select:none;`;

        const moreBtnMarker = document.createElement('span');
        moreBtnMarker.style.cssText = `width:6px;height:6px;flex-shrink:0;align-self:center;border-radius:1px;box-sizing:border-box;margin-top:1px;`;

        const moreBtn = document.createElement('button');
        moreBtn.textContent = 'さらに読み込む';
        moreBtn.style.cssText = `background:transparent;border:none;padding:2px 4px;color:${TEXT_MID};font-size:inherit;cursor:pointer;text-align:left;font-family:inherit;line-height:inherit;width:100%;`;

        moreBtn.addEventListener('mouseenter', () => { moreBtn.style.color = TEXT_HIGH; });
        moreBtn.addEventListener('mouseleave', () => { moreBtn.style.color = TEXT_MID; });
        moreBtn.addEventListener('click', async () => {
          moreBtn.textContent = '読み込み中...';
          moreBtn.style.cursor = 'default';
          const offset = col.nextOffset ?? col.nodes.length;
          const lang = ctx.state.showFallback ? undefined : ctx.state.lang;
          const neighborOf = ctx.state.bookmarks.size > 0 ? [...ctx.state.bookmarks] : undefined;
          const { nodes: newNodes, hasMore: newHasMore } = await fetchAllNodes(ctx.gId, [...ctx.state.bookmarks], offset, lang, neighborOf);
          if (ctx.state.columns[colIndex]) {
            // Append only nodes not already in the list
            const existingIds = new Set(ctx.state.columns[colIndex].nodes.map((n) => n.id));
            const fresh = newNodes.filter((n) => !existingIds.has(n.id));
            ctx.state.columns[colIndex].nodes.push(...fresh);
            ctx.state.columns[colIndex].hasMore = newHasMore;
            ctx.state.columns[colIndex].nextOffset = offset + newNodes.length;
            for (const n of fresh) {
              list.insertBefore(ctx.buildNodeRow(n, colIndex), moreBtnWrapper);
            }
          }
          if (newHasMore) {
            moreBtn.textContent = 'さらに読み込む';
            moreBtn.style.cursor = 'pointer';
          } else {
            moreBtnWrapper.remove();
          }
        });

        moreBtnWrapper.appendChild(moreBtnStar);
        moreBtnWrapper.appendChild(moreBtnMarker);
        moreBtnWrapper.appendChild(moreBtn);
        list.appendChild(moreBtnWrapper);
      }
    }
    colEl.appendChild(list);
    return colEl;
  };

  return { loadColumn, rebuildAll, appendColumn, buildColumnEl, onNodeFocus, refreshRowStyles };
}
