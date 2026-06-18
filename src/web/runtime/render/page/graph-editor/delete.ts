import type { ExplorerNode, PendingDelete, GraphEditorContext } from './types';
import { BORDER, TEXT_MID, TEXT_HIGH, SELECT_STRONG, primaryLabel, fallbackLabel } from './constants';
import { apiDeleteNode } from './api';

// Deletion is held for UNDO_MS before hitting the backend so it can be undone.
const UNDO_MS = 6000;

export function createDeleteFns(ctx: GraphEditorContext): {
  deleteNode: GraphEditorContext['deleteNode'];
} {
  let pendingDelete: PendingDelete | null = null;

  // ── Undo toast ────────────────────────────────────────────────────
  let undoToastEl: HTMLElement | null = null;
  const hideUndoToast = () => { undoToastEl?.remove(); undoToastEl = null; };
  const showUndoToast = (node: ExplorerNode) => {
    hideUndoToast();
    const toast = document.createElement('div');
    toast.style.cssText = `
      position:absolute;left:50%;bottom:16px;transform:translateX(-50%);
      display:flex;align-items:center;gap:12px;z-index:9999;
      background:#2a2a2a;border:1px solid ${BORDER};border-radius:6px;
      padding:8px 14px;box-shadow:0 4px 12px rgba(0,0,0,0.5);font-size:12px;white-space:nowrap;
    `;
    const label = primaryLabel(node, ctx.state.lang) ?? fallbackLabel(node, ctx.state.lang);
    const msg = document.createElement('span');
    msg.style.color = TEXT_MID;
    msg.textContent = label ? `「${label}」を削除しました` : 'ノードを削除しました';
    const btn = document.createElement('button');
    btn.textContent = '元に戻す';
    btn.style.cssText = `background:transparent;border:1px solid ${SELECT_STRONG};color:${TEXT_HIGH};cursor:pointer;font-size:12px;padding:2px 10px;border-radius:4px;line-height:1.5;`;
    btn.addEventListener('click', () => undoDelete());
    toast.appendChild(msg);
    toast.appendChild(btn);
    ctx.outer.appendChild(toast);
    undoToastEl = toast;
  };

  // Commit the pending deletion to the backend (called on timeout, or when a new delete starts).
  const finalizeDelete = () => {
    if (!pendingDelete) return;
    const p = pendingDelete;
    pendingDelete = null;
    ctx.pendingDeleteId = null;
    clearTimeout(p.timer);
    hideUndoToast();
    void apiDeleteNode(ctx.gId, p.node.id);
  };

  // Restore only the deleted node — do not overwrite the entire column state so that
  // nodes created during the undo window are preserved.
  const undoDelete = () => {
    if (!pendingDelete) return;
    const p = pendingDelete;
    clearTimeout(p.timer);
    pendingDelete = null;
    ctx.pendingDeleteId = null;
    hideUndoToast();
    // Re-insert the deleted node at its original position (clamped to current length)
    if (ctx.state.columns[p.colIndex]) {
      const idx = Math.min(p.insertIndex, ctx.state.columns[p.colIndex].nodes.length);
      ctx.state.columns[p.colIndex].nodes.splice(idx, 0, p.node);
    }
    if (p.snapshotCache) ctx.childrenCache.set(p.parentId, p.snapshotCache);
    else ctx.childrenCache.delete(p.parentId);
    // Rebuild only the affected column
    const colEl = ctx.columnsEl.children[p.colIndex] as HTMLElement | undefined;
    if (colEl) {
      ctx.columnsEl.replaceChild(ctx.buildColumnEl(p.colIndex), colEl);
    } else {
      ctx.rebuildAll();
    }
    // Restore selection and reload children if the node was selected when deleted
    if (p.wasSelected && ctx.state.columns[p.colIndex]) {
      ctx.state.columns[p.colIndex].selectedId = p.node.id;
      void ctx.loadColumn(p.node.id, p.colIndex + 1);
    }
    ctx.refreshAllMarkers();
    ctx.refreshAllNodeText();
    ctx.refreshBreadcrumb();
  };

  const deleteNode = (node: ExplorerNode, colIndex: number, focusNodeId?: string) => {
    // Only one deletion can be pending at a time — commit any previous one first.
    if (pendingDelete) finalizeDelete();
    const parentId = ctx.state.columns[colIndex]?.parentId ?? null;
    const insertIndex = ctx.state.columns[colIndex]?.nodes.indexOf(node) ?? -1;
    const wasSelected = ctx.state.columns[colIndex]?.selectedId === node.id;
    const snapshotCache = ctx.childrenCache.get(parentId)?.slice();
    // Optimistic: update UI immediately (backend call is deferred until the undo window closes)
    ctx.pendingDeleteId = node.id;
    ctx.childrenCache.delete(parentId);
    if (ctx.state.columns[colIndex]) {
      ctx.state.columns[colIndex].nodes = ctx.state.columns[colIndex].nodes.filter((n) => n.id !== node.id);
      if (wasSelected) {
        ctx.state.columns[colIndex].selectedId = null;
        ctx.state.columns = ctx.state.columns.slice(0, colIndex + 1);
      }
    }
    ctx.rebuildAll();
    ctx.refreshBreadcrumb();
    // Re-focus the node above (or below if it was first)
    if (focusNodeId) {
      const colEl = ctx.columnsEl.children[colIndex] as HTMLElement | undefined;
      const target = colEl?.querySelector<HTMLTextAreaElement>(`textarea[data-node-id="${focusNodeId}"]`);
      if (target) {
        target.focus();
        target.setSelectionRange(target.value.length, target.value.length);
      }
    }
    const timer = setTimeout(() => finalizeDelete(), UNDO_MS);
    pendingDelete = { node, colIndex, insertIndex, wasSelected, parentId, snapshotCache, timer };
    showUndoToast(node);
  };

  return { deleteNode };
}
