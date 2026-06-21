import type { ExplorerNode, GraphEditorContext } from './types';
import { TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG, primaryLabel, fallbackLabel } from './constants';
import { apiUpdateNode, apiAddBookmark, apiRemoveBookmark, apiToggleLink, fetchChildren } from './api';
import { showColorPicker } from './color-picker';
import { createNodeKeydownHandler, type SaveTimerRef } from './keyboard';

export function createNodeRowFns(ctx: GraphEditorContext): {
  buildNodeRow: GraphEditorContext['buildNodeRow'];
  getColumnTextareas: GraphEditorContext['getColumnTextareas'];
  setLinkSource: GraphEditorContext['setLinkSource'];
  refreshAllMarkers: GraphEditorContext['refreshAllMarkers'];
  refreshAllNodeText: GraphEditorContext['refreshAllNodeText'];
} {
  // Update filled/empty state of every visible marker based on linkedNodeIds
  const refreshAllMarkers = () => {
    ctx.columnsEl.querySelectorAll<HTMLElement>('[data-marker-node-id]').forEach((marker) => {
      const nid = marker.dataset.markerNodeId!;
      if (nid === ctx.state.linkSourceId) return;
      const color = marker.dataset.markerColor || undefined;
      if (!color) {
        const isLinked = ctx.state.linkedNodeIds.has(nid);
        marker.style.background = isLinked ? TEXT_MID : 'transparent';
        marker.style.border = isLinked ? 'none' : `1.5px solid ${TEXT_DIM}`;
      }
    });
  };

  // Dim text globally: selected=TEXT_HIGH, linked=TEXT_MID, unlinked=TEXT_DIM
  const refreshAllNodeText = () => {
    ctx.columnsEl.querySelectorAll<HTMLTextAreaElement>('textarea[data-node-id]').forEach((ta) => {
      const nid = ta.dataset.nodeId!;
      const hasText = ta.value.length > 0;
      if (!ctx.state.linkSourceId) {
        ta.style.color = hasText ? TEXT_MID : TEXT_DIM;
      } else if (nid === ctx.state.linkSourceId) {
        ta.style.color = hasText ? TEXT_HIGH : TEXT_DIM;
      } else if (ctx.state.linkedNodeIds.has(nid)) {
        ta.style.color = hasText ? TEXT_MID : TEXT_DIM;
      } else {
        ta.style.color = TEXT_DIM;
      }
    });
  };

  // Set link source and fetch its connected nodes to update marker states
  const setLinkSource = async (nodeId: string) => {
    if (ctx.state.linkSourceId === nodeId) return;
    ctx.state.linkSourceId = nodeId;
    let linked: ExplorerNode[];
    if (ctx.childrenCache.has(nodeId)) {
      linked = ctx.childrenCache.get(nodeId)!;
    } else {
      linked = await fetchChildren(ctx.gId, nodeId, 500);
    }
    if (ctx.state.linkSourceId !== nodeId) return; // focus changed during fetch
    ctx.state.linkedNodeIds = new Set(linked.map((n) => n.id));
    refreshAllMarkers();
    refreshAllNodeText();
  };

  const getColumnTextareas = (colIndex: number): HTMLTextAreaElement[] => {
    const colEl = ctx.columnsEl.children[colIndex];
    if (!colEl) return [];
    return Array.from(colEl.querySelectorAll<HTMLTextAreaElement>('[data-list] textarea[data-node-id]'));
  };

  const buildNodeRow = (node: ExplorerNode, colIndex: number): HTMLElement => {
    const selected = ctx.state.columns[colIndex]?.selectedId === node.id;
    const isBookmarked = ctx.state.bookmarks.has(node.id);

    const row = document.createElement('div');
    row.dataset.nodeId = node.id;
    row.style.cssText = `
      display:flex;align-items:flex-start;gap:4px;
      padding:1px 8px 1px 8px;flex-shrink:0;
      background:transparent;
      border-left:2px solid ${selected ? SELECT_STRONG : 'transparent'};
    `;

    // Star bookmark (☆ unfilled / ★ filled)
    const star = document.createElement('span');
    star.textContent = isBookmarked ? '★' : '☆';
    star.title = isBookmarked ? 'ブックマーク解除' : 'ブックマーク';
    star.style.cssText = `
      flex-shrink:0;align-self:center;cursor:pointer;font-size:10px;line-height:1;
      color:${isBookmarked ? 'rgba(255,190,60,0.9)' : TEXT_DIM};
      margin-top:1px;user-select:none;
    `;
    star.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const nowBookmarked = !ctx.state.bookmarks.has(node.id);
      if (nowBookmarked) {
        ctx.state.bookmarks.add(node.id);
        void apiAddBookmark(ctx.gId, node.id);
        if (ctx.state.columns[0] && !ctx.state.columns[0].nodes.some((n) => n.id === node.id)) {
          ctx.state.columns[0].nodes.unshift(node);
        }
      } else {
        ctx.state.bookmarks.delete(node.id);
        void apiRemoveBookmark(ctx.gId, node.id);
      }
      ctx.childrenCache.delete(null);
      star.textContent = nowBookmarked ? '★' : '☆';
      star.style.color = nowBookmarked ? 'rgba(255,190,60,0.9)' : TEXT_DIM;
      star.title = nowBookmarked ? 'ブックマーク解除' : 'ブックマーク';
      (document.activeElement as HTMLElement | null)?.blur();
      if (ctx.state.columns[0]) {
        const col0El = ctx.columnsEl.children[0] as HTMLElement | undefined;
        if (col0El) {
          const listEl = col0El.querySelector<HTMLElement>('[data-list]');
          const scrollTop = listEl?.scrollTop ?? 0;
          const newCol0El = ctx.buildColumnEl(0);
          ctx.columnsEl.replaceChild(newCol0El, col0El);
          const newListEl = newCol0El.querySelector<HTMLElement>('[data-list]');
          if (newListEl) newListEl.scrollTop = scrollTop;
        }
      }
    });
    row.appendChild(star);

    // Marker dot (left-click to toggle link with selected node; right-click for color picker)
    const marker = document.createElement('span');
    marker.dataset.marker = '1';
    marker.dataset.markerNodeId = node.id;
    marker.dataset.markerColor = node.color ?? '';
    marker.style.cssText = `
      width:6px;height:6px;flex-shrink:0;align-self:center;
      border-radius:1px;box-sizing:border-box;
      background:${node.color ?? 'transparent'};
      border:${node.color ? 'none' : `1.5px solid ${TEXT_DIM}`};
      margin-top:1px;cursor:context-menu;
    `;
    marker.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showColorPicker(ctx, marker, node, colIndex);
    });
    marker.addEventListener('click', async () => {
      if (!ctx.state.linkSourceId || ctx.state.linkSourceId === node.id) return;
      const linked = await apiToggleLink(ctx.gId, ctx.state.linkSourceId, node.id);
      if (linked) {
        ctx.state.linkedNodeIds.add(node.id);
      } else {
        ctx.state.linkedNodeIds.delete(node.id);
      }
      refreshAllMarkers();
      refreshAllNodeText();
      ctx.childrenCache.delete(ctx.state.linkSourceId);
      ctx.childrenCache.delete(node.id);
    });
    row.appendChild(marker);

    // Textarea
    const inp = document.createElement('textarea');
    inp.rows = 1;
    const prim = primaryLabel(node, ctx.state.lang);
    inp.value = prim ?? '';
    inp.placeholder = fallbackLabel(node, ctx.state.lang);
    inp.dataset.nodeId = node.id;
    Object.assign(inp.style, {
      display: 'block',
      width: '100%',
      border: 'none',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
      padding: '2px 4px',
      boxSizing: 'border-box',
      background: 'transparent',
      color: prim != null ? TEXT_MID : TEXT_DIM,
    });
    (inp.style as unknown as Record<string, string>)['field-sizing'] = 'content';

    inp.addEventListener('focus', () => {
      inp.style.color = inp.value ? TEXT_HIGH : TEXT_DIM;
      void setLinkSource(node.id);
      ctx.onNodeFocus(colIndex, node.id);
    });

    const saveTimer: SaveTimerRef = { current: null };
    inp.addEventListener('input', () => {
      if (ctx.state.lang === 'en') node.en = inp.value || undefined;
      else node.ja = inp.value || undefined;
      inp.style.color = inp.value ? TEXT_HIGH : TEXT_DIM;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void apiUpdateNode(ctx.gId, node.id, ctx.state.lang, inp.value.trim());
      }, 800);
    });

    inp.addEventListener('keydown', createNodeKeydownHandler(ctx, node, inp, row, colIndex, saveTimer));

    // ── Column DnD: drag initiation only ─────────────────────────────
    // Drop handling lives at the column (list) level in column.ts, so the
    // ENTIRE column is a drop surface (gaps/padding included) and the cursor
    // never shows "forbidden" between rows. Here we only start the drag.
    let colDragReady = false;
    // Drag handle: anywhere on the row except the textarea (text editing) and
    // the star (bookmark toggle). Covers marker dot, gaps, non-interactive areas.
    row.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t === star) return;
      if (e.pointerType !== 'mouse') return;
      colDragReady = true;
      row.draggable = true;
    });
    const resetDraggable = () => {
      if (!ctx.colDndNodeId) { row.draggable = false; colDragReady = false; }
    };
    row.addEventListener('pointerup', resetDraggable);
    row.addEventListener('pointercancel', resetDraggable);
    row.addEventListener('dragstart', (e) => {
      if (!colDragReady) { e.preventDefault(); return; }
      ctx.colDndNodeId = node.id;
      ctx.colDndColIndex = colIndex;
      row.style.opacity = '0.5';
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id); }
    });
    row.addEventListener('dragend', () => {
      row.draggable = false; colDragReady = false;
      ctx.colDndNodeId = null; ctx.colDndColIndex = -1;
      row.style.opacity = '';
      ctx.columnsEl.querySelectorAll<HTMLElement>('[data-node-id]:not(textarea),[data-col-drop-zone]').forEach(el => {
        el.style.boxShadow = '';
      });
    });

    row.addEventListener('mousedown', (e: MouseEvent) => {
      if (!e.shiftKey) return;
      e.preventDefault();
      if (!ctx.state.linkSourceId || ctx.state.linkSourceId === node.id) return;
      const sourceIsBookmarked = ctx.state.bookmarks.has(ctx.state.linkSourceId);
      const targetIsBookmarked = ctx.state.bookmarks.has(node.id);
      // ソース列のインデックスを保存（API完了後も使えるよう）
      const sourceColIdx = ctx.state.columns.findIndex((col) => col.selectedId === ctx.state.linkSourceId);
      void apiToggleLink(ctx.gId, ctx.state.linkSourceId, node.id).then((linked) => {
        if (linked) {
          ctx.state.linkedNodeIds.add(node.id);
          // ブックマーク同士を繋いだ時のみ、繋がれた側のブックマークを解除
          if (sourceIsBookmarked && targetIsBookmarked) {
            ctx.state.bookmarks.delete(node.id);
            void apiRemoveBookmark(ctx.gId, node.id);
            ctx.childrenCache.delete(null);
            // col0 から対象行だけをDOMで直接削除（再読み込みなし）
            const col0El = ctx.columnsEl.children[0] as HTMLElement | undefined;
            if (col0El) {
              const targetRow = col0El.querySelector<HTMLElement>(`[data-node-id="${node.id}"]:not(textarea)`);
              targetRow?.remove();
              if (ctx.state.columns[0]) {
                ctx.state.columns[0].nodes = ctx.state.columns[0].nodes.filter((n) => n.id !== node.id);
              }
            }
          }
          // ソースの次の列（n+1）に接続先ノードをDOMへ直接追加
          const nextColIdx = sourceColIdx + 1;
          if (sourceColIdx >= 0 && nextColIdx < ctx.state.columns.length) {
            const col = ctx.state.columns[nextColIdx];
            if (col && !col.nodes.some((n) => n.id === node.id)) {
              col.nodes.push(node);
              ctx.childrenCache.delete(ctx.state.linkSourceId!);
              const nextColEl = ctx.columnsEl.children[nextColIdx] as HTMLElement | undefined;
              const listEl = nextColEl?.querySelector<HTMLElement>('[data-list]');
              if (listEl) {
                listEl.appendChild(buildNodeRow(node, nextColIdx));
              }
            }
          }
        } else {
          ctx.state.linkedNodeIds.delete(node.id);
        }
        refreshAllMarkers();
        refreshAllNodeText();
        ctx.childrenCache.delete(ctx.state.linkSourceId!);
        ctx.childrenCache.delete(node.id);
      });
    });
    row.appendChild(inp);

    // Child-count badge (col 0 only). Updated in-place when prefetch completes.
    if (colIndex === 0) {
      const countEl = document.createElement('span');
      countEl.dataset.countFor = node.id;
      const cached = ctx.childrenCache.get(node.id);
      if (cached !== undefined && cached.length > 0) countEl.textContent = String(cached.length);
      Object.assign(countEl.style, {
        flexShrink: '0',
        alignSelf: 'center',
        fontSize: '10px',
        color: TEXT_DIM,
        minWidth: '14px',
        textAlign: 'right',
        userSelect: 'none',
        paddingRight: '4px',
      });
      row.appendChild(countEl);
    }

    return row;
  };

  return { buildNodeRow, getColumnTextareas, setLinkSource, refreshAllMarkers, refreshAllNodeText };
}
