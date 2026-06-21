import type { ExplorerNode, GraphEditorContext } from './types';
import { apiUpdateNode, apiCreateNode, apiAddBookmark, apiMoveBookmark, apiMoveNode } from './api';

export type SaveTimerRef = { current: ReturnType<typeof setTimeout> | null };

// keydown handler for a node's textarea. `row` is the row element the textarea lives in
// (needed to insert a sibling on Enter); `saveTimer` is shared with the input listener in
// buildNodeRow so a pending debounced save can be flushed/cancelled on Enter.
export function createNodeKeydownHandler(
  ctx: GraphEditorContext,
  node: ExplorerNode,
  inp: HTMLTextAreaElement,
  row: HTMLElement,
  colIndex: number,
  saveTimer: SaveTimerRef,
): (e: KeyboardEvent) => Promise<void> {
  return async (e: KeyboardEvent) => {
    const { state, gId } = ctx;
    if (e.key === 'Escape') { inp.blur(); return; }

    // Ctrl+Enter → save current text, move focus to next node below (no new node)
    if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      void apiUpdateNode(gId, node.id, state.lang, inp.value.trim());
      const textareas = ctx.getColumnTextareas(colIndex);
      const myIdx = textareas.indexOf(inp);
      const next = textareas[myIdx + 1];
      if (next) {
        next.focus();
        requestAnimationFrame(() => { next.setSelectionRange(0, 0); });
      }
      return;
    }

    // Enter → add new node below; Shift+Enter → newline (default)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const col = state.columns[colIndex];
      if (!col) return;
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      void apiUpdateNode(gId, node.id, state.lang, inp.value.trim());
      ctx.childrenCache.delete(col.parentId);
      // Optimistic: insert temp node below current node immediately
      const tempId = `temp-${++ctx.tempNodeCounter}`;
      const tempNode: ExplorerNode = { id: tempId };
      if (colIndex === 0) state.bookmarks.add(tempId);
      const insertIdx = state.columns[colIndex].nodes.indexOf(node);
      state.columns[colIndex].nodes.splice(insertIdx + 1, 0, tempNode);
      const tempRow = ctx.buildNodeRow(tempNode, colIndex);
      row.insertAdjacentElement('afterend', tempRow);
      tempRow.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      const newNode = await apiCreateNode(gId, col.parentId, state.lang, '', col.parentId ? node.id : undefined);
      if (!newNode || !state.columns[colIndex]) return;
      // Replace temp node with real node in-place
      const realIdx = state.columns[colIndex].nodes.indexOf(tempNode);
      if (realIdx !== -1) state.columns[colIndex].nodes[realIdx] = newNode;
      if (colIndex === 0) {
        state.bookmarks.delete(tempId);
        state.bookmarks.add(newNode.id);
        void apiAddBookmark(gId, newNode.id);
      }
      // Mutate tempNode so the row's event-listener closures pick up the real id.
      Object.assign(tempNode, newNode);
      // Update DOM: replace all data-node-id references from tempId to real id
      const colEl = ctx.columnsEl.children[colIndex] as HTMLElement | undefined;
      colEl?.querySelectorAll<HTMLElement>(`[data-node-id="${tempId}"]`).forEach((el) => {
        el.dataset.nodeId = newNode.id;
      });
      // Flush any text typed while the API call was in-flight.
      const newTextarea = colEl?.querySelector<HTMLTextAreaElement>(`textarea[data-node-id="${newNode.id}"]`);
      if (newTextarea?.value.trim()) {
        void apiUpdateNode(gId, newNode.id, state.lang, newTextarea.value.trim());
      }
      if (state.linkSourceId === tempId) {
        void ctx.setLinkSource(newNode.id);
      }
      if (state.columns[colIndex]?.selectedId === tempId) {
        ctx.onNodeFocus(colIndex, newNode.id);
      }
      return;
    }

    // Ctrl+Shift+Backspace → delete node, focus node above
    if (e.key === 'Backspace' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      const textareas = ctx.getColumnTextareas(colIndex);
      const myIdx = textareas.indexOf(inp);
      const focusTarget = textareas[myIdx > 0 ? myIdx - 1 : myIdx + 1];
      ctx.deleteNode(node, colIndex, focusTarget?.dataset.nodeId);
      return;
    }

    // Shift+Alt+Up/Down → reorder node in column
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && e.altKey) {
      e.preventDefault();
      const col = state.columns[colIndex];
      if (!col) return;
      const idx = col.nodes.indexOf(node);
      if (idx === -1) return;
      const direction = e.key === 'ArrowUp' ? 'up' : 'down';
      if (colIndex === 0 && state.bookmarks.has(node.id)) {
        // Bookmark reorder via API — swap with adjacent bookmark
        const bkNodes = col.nodes.filter((n) => state.bookmarks.has(n.id));
        const bkIdx = bkNodes.indexOf(node);
        const targetBk = direction === 'up' ? bkNodes[bkIdx - 1] : bkNodes[bkIdx + 1];
        if (!targetBk) return;
        void apiMoveBookmark(gId, node.id, direction);
        const targetIdx = col.nodes.indexOf(targetBk);
        col.nodes.splice(idx, 1);
        col.nodes.splice(targetIdx < idx ? targetIdx : targetIdx - 1 + (direction === 'down' ? 1 : 0), 0, node);
      } else {
        const dir = direction === 'up' ? -1 : 1;
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= col.nodes.length) return;
        col.nodes.splice(idx, 1);
        col.nodes.splice(newIdx, 0, node);
        if (col.parentId) {
          const afterSwapSiblingIds = col.nodes.map((n) => n.id);
          void apiMoveNode(gId, node.id, col.parentId, direction, afterSwapSiblingIds);
        }
        ctx.saveChildrenCache?.();
      }
      const colEl = ctx.columnsEl.children[colIndex] as HTMLElement | undefined;
      if (colEl) {
        ctx.columnsEl.replaceChild(ctx.buildColumnEl(colIndex), colEl);
        const newColEl = ctx.columnsEl.children[colIndex] as HTMLElement | undefined;
        const movedInp = newColEl?.querySelector<HTMLTextAreaElement>(`textarea[data-node-id="${node.id}"]`);
        movedInp?.focus();
      }
      return;
    }

    // ArrowUp at start → focus previous node's textarea
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !e.ctrlKey) {
      if (inp.selectionStart === 0 && inp.selectionEnd === 0) {
        e.preventDefault();
        const textareas = ctx.getColumnTextareas(colIndex);
        const myIdx = textareas.indexOf(inp);
        const prev = textareas[myIdx - 1];
        if (prev) {
          prev.focus();
          requestAnimationFrame(() => {
            prev.setSelectionRange(prev.value.length, prev.value.length);
          });
        }
        return;
      }
    }

    // ArrowDown at end → focus next node's textarea
    if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey && !e.ctrlKey) {
      if (inp.selectionStart === inp.value.length && inp.selectionEnd === inp.value.length) {
        e.preventDefault();
        const textareas = ctx.getColumnTextareas(colIndex);
        const myIdx = textareas.indexOf(inp);
        const next = textareas[myIdx + 1];
        if (next) {
          next.focus();
          requestAnimationFrame(() => {
            next.setSelectionRange(0, 0);
          });
        }
        return;
      }
    }
  };
}
