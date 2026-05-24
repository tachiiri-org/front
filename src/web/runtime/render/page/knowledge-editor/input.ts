import type { TreeNode } from '../../../../schema/component/kind/tree-editor';
import type { KnowledgeEditorContext } from './types';
import { findNode, flatIds, dispatchNodeFocus, dispatchNodeTextChange, updateNodeSelectionVisuals } from './ops';
import { createKeydownHandler } from './keyboard';

export const createInput = (node: TreeNode, ctx: KnowledgeEditorContext): HTMLTextAreaElement => {
  const { state } = ctx;
  const input = document.createElement('textarea');
  input.rows = 1;
  input.dataset.nodeId = node.id;
  input.dataset.navInput = 'node';
  Object.assign(input.style, {
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
  });
  (input.style as unknown as Record<string, string>)['field-sizing'] = 'content';

  input.addEventListener('focus', () => {
    if (state.focusedNodeId !== node.id) {
      const fromMouse = state.mousedownNodeId === node.id;
      state.mousedownNodeId = null;
      state.focusedNodeId = node.id;
      dispatchNodeFocus(ctx.id, node.id, input.value);
      state.pendingFocusId = node.id;
      if (fromMouse) {
        state.pendingSelectionStart = input.selectionStart;
        ctx.render();
      } else {
        ctx.scheduleRender();
      }
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
    if (input.value === '?') {
      const loc = findNode(state.nodes, node.id);
      if (loc) {
        loc.parent[loc.index].type = 'issue';
        loc.parent[loc.index].text = '';
        input.value = '';
        state.inputCache.delete(node.id);
        state.pendingFocusId = node.id;
        ctx.scheduleSave();
        ctx.render();
      }
      return;
    }
    const loc = findNode(state.nodes, node.id);
    if (loc) {
      loc.parent[loc.index].text = input.value;
      if (state.focusedNodeId === node.id) dispatchNodeTextChange(ctx.id, node.id, input.value);
      ctx.scheduleSave();
    }
  });

  input.addEventListener('mousedown', (e: MouseEvent) => {
    state.mousedownNodeId = node.id;
    if (e.shiftKey) {
      e.preventDefault();
      const allIds = flatIds(state.nodes);
      const idx = allIds.indexOf(node.id);
      if (state.anchorIdx === null) state.anchorIdx = idx;
      state.activeIdx = idx;
      updateNodeSelectionVisuals(ctx.outer, allIds, state.anchorIdx, state.activeIdx);
      return;
    }
    if (state.anchorIdx === null) return;
    state.anchorIdx = null;
    state.activeIdx = null;
    updateNodeSelectionVisuals(ctx.outer, [], null, null);
  });

  input.addEventListener('keydown', createKeydownHandler(node, input, ctx));

  return input;
};

