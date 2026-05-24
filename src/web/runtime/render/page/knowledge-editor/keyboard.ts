import type { TreeNode } from '../../../../schema/component/kind/tree-editor';
import type { KnowledgeEditorContext } from './types';
import {
  flatIds, findNode, findDedentTarget, getAncestors, cloneNodes, reassignIds, randomId,
  updateNodeSelectionVisuals,
} from './ops';

export const createKeydownHandler = (
  node: TreeNode,
  input: HTMLTextAreaElement,
  ctx: KnowledgeEditorContext,
): (e: KeyboardEvent) => void => {
  return (e: KeyboardEvent) => {
    const { state } = ctx;
    const currentLoc = findNode(state.nodes, node.id);
    const currentNode = currentLoc ? currentLoc.parent[currentLoc.index] : null;
    const currentIsProposed = currentNode?.status === 'proposed';

    if (e.key === 'Enter' && e.ctrlKey && currentIsProposed) {
      e.preventDefault();
      ctx.pushHistory();
      if (currentNode) {
        currentNode.status = 'accepted';
        delete currentNode.proposedAt;
        delete currentNode.proposedBy;
      }
      const allIds = flatIds(state.nodes);
      const idx = allIds.indexOf(node.id);
      state.pendingFocusId = idx < allIds.length - 1 ? allIds[idx + 1] : node.id;
      ctx.scheduleSave();
      ctx.render();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey && !e.ctrlKey && !e.altKey) {
        const allIds = flatIds(state.nodes);
        let selIds: string[];
        if (state.anchorIdx !== null && state.activeIdx !== null) {
          const lo = Math.min(state.anchorIdx, state.activeIdx);
          const hi = Math.max(state.anchorIdx, state.activeIdx);
          selIds = allIds.slice(lo, hi + 1);
        } else {
          selIds = [node.id];
        }
        const insertNodes = selIds.map(sid => {
          const loc = findNode(state.nodes, sid);
          return loc ? loc.parent[loc.index] : null;
        }).filter((n): n is TreeNode => n !== null);
        if (insertNodes.length > 0) {
          document.dispatchEvent(new CustomEvent('knowledge-editor:insert-to-doc', {
            detail: { knowledgeEditorFrameId: ctx.id, nodes: insertNodes },
          }));
        }
        return;
      }
      ctx.pushHistory();
      state.anchorIdx = null; state.activeIdx = null;
      const cursor = input.selectionStart ?? input.value.length;
      const tail = input.value.slice(cursor);
      const newNode: TreeNode = { id: randomId(), text: tail };
      if (currentLoc) {
        currentLoc.parent[currentLoc.index].text = input.value.slice(0, cursor);
        input.value = input.value.slice(0, cursor);
        currentLoc.parent.splice(currentLoc.index + 1, 0, newNode);
      } else {
        state.nodes.push(newNode);
      }
      state.pendingFocusId = newNode.id;
      ctx.scheduleSave();
      ctx.render();
      return;
    }

    if (e.key === 'Backspace' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      ctx.pushHistory();
      state.anchorIdx = null; state.activeIdx = null;
      const allIds = flatIds(state.nodes);
      const idx = allIds.indexOf(node.id);
      const prevId = idx > 0 ? allIds[idx - 1] : null;
      if (currentLoc) currentLoc.parent.splice(currentLoc.index, 1);
      state.focusedNodeId = prevId;
      state.pendingFocusId = prevId;
      ctx.scheduleSave();
      ctx.render();
      return;
    }

    if (e.key === 'Backspace' && input.value === '') {
      e.preventDefault();
      ctx.pushHistory();
      state.anchorIdx = null; state.activeIdx = null;
      const allIds = flatIds(state.nodes);
      const idx = allIds.indexOf(node.id);
      const prevId = idx > 0 ? allIds[idx - 1] : null;
      if (currentLoc) currentLoc.parent.splice(currentLoc.index, 1);
      state.focusedNodeId = prevId;
      state.pendingFocusId = prevId;
      ctx.scheduleSave();
      ctx.render();
      return;
    }

    if (e.key === 'ArrowRight' && e.altKey) {
      e.preventDefault();
      if (state.activeDocNodeId !== null) {
        const allIds = flatIds(state.nodes);
        let selIds: string[];
        if (state.anchorIdx !== null && state.activeIdx !== null) {
          const lo = Math.min(state.anchorIdx, state.activeIdx);
          const hi = Math.max(state.anchorIdx, state.activeIdx);
          selIds = allIds.slice(lo, hi + 1);
        } else {
          selIds = [node.id];
        }
        const idSet = new Set(selIds);
        const topLevelSelIds = selIds.filter(sid => {
          const ancestors = getAncestors(sid, state.nodes);
          return ancestors !== null && !ancestors.some(a => idSet.has(a));
        });
        const moveNodes = topLevelSelIds.map(sid => {
          const loc = findNode(state.nodes, sid);
          return loc ? cloneNodes([loc.parent[loc.index]])[0] : null;
        }).filter((n): n is TreeNode => n !== null);
        if (moveNodes.length > 0) {
          document.dispatchEvent(new CustomEvent('knowledge-editor:insert-to-doc', {
            detail: { knowledgeEditorFrameId: ctx.id, nodes: moveNodes },
          }));
          ctx.pushHistory();
          const firstFlatIdx = allIds.indexOf(selIds[0]);
          for (const sid of [...topLevelSelIds].reverse()) {
            const loc = findNode(state.nodes, sid);
            if (loc) loc.parent.splice(loc.index, 1);
          }
          state.anchorIdx = null; state.activeIdx = null;
          const newAllIds = flatIds(state.nodes);
          const focusTarget = firstFlatIdx > 0
            ? newAllIds[Math.min(firstFlatIdx - 1, newAllIds.length - 1)]
            : newAllIds[0];
          state.focusedNodeId = focusTarget ?? null;
          state.pendingFocusId = focusTarget ?? null;
          ctx.scheduleSave();
          ctx.render();
        }
      }
      return;
    }

    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      ctx.pushHistory();
      if (state.anchorIdx !== null && state.activeIdx !== null) {
        const allIds = flatIds(state.nodes);
        const lo = Math.min(state.anchorIdx, state.activeIdx);
        const hi = Math.max(state.anchorIdx, state.activeIdx);
        const selIds = allIds.slice(lo, hi + 1);
        for (const sid of selIds) {
          const sloc = findNode(state.nodes, sid);
          if (sloc && sloc.index > 0) {
            const snode = sloc.parent.splice(sloc.index, 1)[0];
            const prev = sloc.parent[sloc.index - 1];
            if (!prev.children) prev.children = [];
            prev.children.push(snode);
          }
        }
        state.pendingFocusId = node.id;
        ctx.scheduleSave();
        ctx.render();
        const newAllIds = flatIds(state.nodes);
        const newLo = newAllIds.indexOf(selIds[0]);
        const newHi = newAllIds.indexOf(selIds[selIds.length - 1]);
        const wasAsc = state.anchorIdx <= state.activeIdx;
        state.anchorIdx = wasAsc ? newLo : newHi;
        state.activeIdx = wasAsc ? newHi : newLo;
        updateNodeSelectionVisuals(ctx.outer, newAllIds, state.anchorIdx, state.activeIdx);
      } else {
        state.anchorIdx = null; state.activeIdx = null;
        if (currentLoc && currentLoc.index > 0) {
          const snode = currentLoc.parent.splice(currentLoc.index, 1)[0];
          const prev = currentLoc.parent[currentLoc.index - 1];
          if (!prev.children) prev.children = [];
          prev.children.push(snode);
          state.pendingFocusId = node.id;
          ctx.scheduleSave();
          ctx.render();
        }
      }
      return;
    }

    if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      ctx.pushHistory();
      if (state.anchorIdx !== null && state.activeIdx !== null) {
        const allIds = flatIds(state.nodes);
        const lo = Math.min(state.anchorIdx, state.activeIdx);
        const hi = Math.max(state.anchorIdx, state.activeIdx);
        const selIds = allIds.slice(lo, hi + 1);
        for (const sid of [...selIds].reverse()) {
          const allLoc = findDedentTarget(state.nodes, sid);
          if (allLoc) {
            const sloc = findNode(state.nodes, sid);
            if (sloc) {
              const snode = sloc.parent.splice(sloc.index, 1)[0];
              allLoc.parent.splice(allLoc.index + 1, 0, snode);
            }
          }
        }
        state.pendingFocusId = node.id;
        ctx.scheduleSave();
        ctx.render();
        const newAllIds = flatIds(state.nodes);
        const newLo = newAllIds.indexOf(selIds[0]);
        const newHi = newAllIds.indexOf(selIds[selIds.length - 1]);
        const wasAsc = state.anchorIdx <= state.activeIdx;
        state.anchorIdx = wasAsc ? newLo : newHi;
        state.activeIdx = wasAsc ? newHi : newLo;
        updateNodeSelectionVisuals(ctx.outer, newAllIds, state.anchorIdx, state.activeIdx);
      } else {
        state.anchorIdx = null; state.activeIdx = null;
        const allLoc = findDedentTarget(state.nodes, node.id);
        if (allLoc && currentLoc) {
          const snode = currentLoc.parent.splice(currentLoc.index, 1)[0];
          allLoc.parent.splice(allLoc.index + 1, 0, snode);
          state.pendingFocusId = node.id;
          ctx.scheduleSave();
          ctx.render();
        }
      }
      return;
    }

    if (e.key === 'ArrowUp' && e.shiftKey && e.altKey) {
      e.preventDefault();
      if (state.anchorIdx !== null && state.activeIdx !== null) {
        const allIds = flatIds(state.nodes);
        const lo = Math.min(state.anchorIdx, state.activeIdx);
        const hi = Math.max(state.anchorIdx, state.activeIdx);
        const selIds = allIds.slice(lo, hi + 1);
        const firstLoc = findNode(state.nodes, selIds[0]);
        if (firstLoc && firstLoc.index > 0 && selIds.every((sid, i) => firstLoc.parent[firstLoc.index + i]?.id === sid)) {
          ctx.pushHistory();
          const block = firstLoc.parent.splice(firstLoc.index, selIds.length);
          firstLoc.parent.splice(firstLoc.index - 1, 0, ...block);
          ctx.scheduleSave();
          const wasAsc = state.anchorIdx <= state.activeIdx;
          ctx.render();
          const newAllIds = flatIds(state.nodes);
          const newLo = newAllIds.indexOf(selIds[0]);
          const newHi = newAllIds.indexOf(selIds[selIds.length - 1]);
          state.anchorIdx = wasAsc ? newLo : newHi;
          state.activeIdx = wasAsc ? newHi : newLo;
          updateNodeSelectionVisuals(ctx.outer, newAllIds, state.anchorIdx, state.activeIdx);
        }
      } else {
        state.anchorIdx = null; state.activeIdx = null;
        if (currentLoc && currentLoc.index > 0) {
          ctx.pushHistory();
          const tmp = currentLoc.parent[currentLoc.index - 1];
          currentLoc.parent[currentLoc.index - 1] = currentLoc.parent[currentLoc.index];
          currentLoc.parent[currentLoc.index] = tmp;
          state.pendingFocusId = node.id;
          ctx.scheduleSave();
          ctx.render();
        }
      }
      return;
    }

    if (e.key === 'ArrowDown' && e.shiftKey && e.altKey) {
      e.preventDefault();
      if (state.anchorIdx !== null && state.activeIdx !== null) {
        const allIds = flatIds(state.nodes);
        const lo = Math.min(state.anchorIdx, state.activeIdx);
        const hi = Math.max(state.anchorIdx, state.activeIdx);
        const selIds = allIds.slice(lo, hi + 1);
        const firstLoc = findNode(state.nodes, selIds[0]);
        if (firstLoc && firstLoc.index + selIds.length < firstLoc.parent.length && selIds.every((sid, i) => firstLoc.parent[firstLoc.index + i]?.id === sid)) {
          ctx.pushHistory();
          const block = firstLoc.parent.splice(firstLoc.index, selIds.length);
          firstLoc.parent.splice(firstLoc.index + 1, 0, ...block);
          ctx.scheduleSave();
          const wasAsc = state.anchorIdx <= state.activeIdx;
          ctx.render();
          const newAllIds = flatIds(state.nodes);
          const newLo = newAllIds.indexOf(selIds[0]);
          const newHi = newAllIds.indexOf(selIds[selIds.length - 1]);
          state.anchorIdx = wasAsc ? newLo : newHi;
          state.activeIdx = wasAsc ? newHi : newLo;
          updateNodeSelectionVisuals(ctx.outer, newAllIds, state.anchorIdx, state.activeIdx);
        }
      } else {
        state.anchorIdx = null; state.activeIdx = null;
        if (currentLoc && currentLoc.index < currentLoc.parent.length - 1) {
          ctx.pushHistory();
          const tmp = currentLoc.parent[currentLoc.index + 1];
          currentLoc.parent[currentLoc.index + 1] = currentLoc.parent[currentLoc.index];
          currentLoc.parent[currentLoc.index] = tmp;
          state.pendingFocusId = node.id;
          ctx.scheduleSave();
          ctx.render();
        }
      }
      return;
    }

    if (e.key === 'ArrowUp' && e.shiftKey) {
      e.preventDefault();
      const allIds = flatIds(state.nodes);
      const idx = allIds.indexOf(node.id);
      if (idx < 0) return;
      if (state.anchorIdx === null) state.anchorIdx = idx;
      const colIdx = parseInt(input.dataset.columnIndex ?? '0', 10);
      const colInputs = Array.from(ctx.outer.querySelectorAll<HTMLTextAreaElement>(`[data-nav-input][data-column-index="${colIdx}"]`))
        .filter(inp => inp.offsetParent !== null);
      const colPos = colInputs.indexOf(input);
      if (colPos <= 0) return;
      const prevInput = colInputs[colPos - 1];
      const newActiveIdx = allIds.indexOf(prevInput.dataset.nodeId ?? '');
      state.activeIdx = newActiveIdx;
      prevInput.focus({ preventScroll: true });
      updateNodeSelectionVisuals(ctx.outer, allIds, state.anchorIdx, state.activeIdx);
      return;
    }

    if (e.key === 'ArrowDown' && e.shiftKey) {
      e.preventDefault();
      const allIds = flatIds(state.nodes);
      const idx = allIds.indexOf(node.id);
      if (idx < 0) return;
      if (state.anchorIdx === null) state.anchorIdx = idx;
      const colIdx = parseInt(input.dataset.columnIndex ?? '0', 10);
      const colInputs = Array.from(ctx.outer.querySelectorAll<HTMLTextAreaElement>(`[data-nav-input][data-column-index="${colIdx}"]`))
        .filter(inp => inp.offsetParent !== null);
      const colPos = colInputs.indexOf(input);
      if (colPos >= colInputs.length - 1) return;
      const nextInput = colInputs[colPos + 1];
      const newActiveIdx = allIds.indexOf(nextInput.dataset.nodeId ?? '');
      state.activeIdx = newActiveIdx;
      nextInput.focus({ preventScroll: true });
      updateNodeSelectionVisuals(ctx.outer, allIds, state.anchorIdx, state.activeIdx);
      return;
    }

    if (e.key === 'z' && e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (state.history.length > 0) {
        state.nodes = state.history.pop()!;
        state.anchorIdx = null; state.activeIdx = null;
        ctx.scheduleSave();
        ctx.render();
      }
      return;
    }

    if ((e.key === 'c' || e.key === 'x') && e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      const allIds = flatIds(state.nodes);
      let selIds: string[];
      if (state.anchorIdx !== null && state.activeIdx !== null) {
        const lo = Math.min(state.anchorIdx, state.activeIdx);
        const hi = Math.max(state.anchorIdx, state.activeIdx);
        selIds = allIds.slice(lo, hi + 1);
      } else {
        selIds = [node.id];
      }
      const idSet = new Set(selIds);
      const topLevelSelIds = selIds.filter(sid => {
        const ancestors = getAncestors(sid, state.nodes);
        return ancestors !== null && !ancestors.some(a => idSet.has(a));
      });
      state.clipboard = topLevelSelIds.map(sid => {
        const loc = findNode(state.nodes, sid);
        return loc ? cloneNodes([loc.parent[loc.index]])[0] : null;
      }).filter((n): n is TreeNode => n !== null);
      if (state.clipboard.length > 0) {
        const toText = (list: TreeNode[], depth: number): string =>
          list.map(n => {
            const line = '  '.repeat(depth) + n.text;
            return n.children?.length ? line + '\n' + toText(n.children, depth + 1) : line;
          }).join('\n');
        void navigator.clipboard.writeText(toText(state.clipboard, 0)).catch(() => undefined);
      }
      if (e.key === 'x' && state.clipboard.length > 0) {
        ctx.pushHistory();
        const firstFlatIdx = allIds.indexOf(selIds[0]);
        const parentLoc = (() => {
          for (const sid of topLevelSelIds) {
            const ancestors = getAncestors(sid, state.nodes);
            if (ancestors && ancestors.length > 0) return ancestors[ancestors.length - 1];
          }
          return null;
        })();
        for (const sid of [...topLevelSelIds].reverse()) {
          const loc = findNode(state.nodes, sid);
          if (loc) loc.parent.splice(loc.index, 1);
        }
        state.anchorIdx = null; state.activeIdx = null;
        const newAllIds = flatIds(state.nodes);
        const focusTarget = parentLoc && newAllIds.includes(parentLoc)
          ? parentLoc
          : firstFlatIdx > 0
          ? newAllIds[Math.min(firstFlatIdx - 1, newAllIds.length - 1)]
          : newAllIds[0];
        state.focusedNodeId = focusTarget ?? null;
        state.pendingFocusId = focusTarget ?? null;
        ctx.scheduleSave();
        ctx.render();
      }
      return;
    }

    if (e.key === 'v' && e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (!state.clipboard || state.clipboard.length === 0) return;
      ctx.pushHistory();
      const pasted = reassignIds(state.clipboard);
      if (currentLoc) {
        currentLoc.parent.splice(currentLoc.index + 1, 0, ...pasted);
      } else {
        state.nodes.push(...pasted);
      }
      state.anchorIdx = null; state.activeIdx = null;
      state.pendingFocusId = pasted[0].id;
      ctx.scheduleSave();
      ctx.render();
      return;
    }

    if (e.key === 'ArrowRight' && e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (state.anchorIdx !== null) { state.anchorIdx = null; state.activeIdx = null; updateNodeSelectionVisuals(ctx.outer, [], null, null); }
      if (currentNode?.children?.length) {
        state.focusedNodeId = currentNode.children[0].id;
        state.pendingFocusId = currentNode.children[0].id;
        ctx.render();
      }
      return;
    }

    if (e.key === 'ArrowLeft' && e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (state.anchorIdx !== null) { state.anchorIdx = null; state.activeIdx = null; updateNodeSelectionVisuals(ctx.outer, [], null, null); }
      const ancestors = getAncestors(node.id, state.nodes);
      if (ancestors && ancestors.length > 0) {
        state.focusedNodeId = ancestors[ancestors.length - 1];
        state.pendingFocusId = ancestors[ancestors.length - 1];
        ctx.render();
      }
      return;
    }

    if (e.key === 'ArrowRight' && !e.altKey && !e.ctrlKey && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
      e.preventDefault();
      if (state.anchorIdx !== null) { state.anchorIdx = null; state.activeIdx = null; updateNodeSelectionVisuals(ctx.outer, [], null, null); }
      if (currentNode?.children?.length) {
        state.focusedNodeId = currentNode.children[0].id;
        state.pendingFocusId = currentNode.children[0].id;
        ctx.render();
      }
      return;
    }

    if (e.key === 'ArrowLeft' && !e.altKey && !e.ctrlKey && input.selectionStart === 0 && input.selectionEnd === 0) {
      e.preventDefault();
      if (state.anchorIdx !== null) { state.anchorIdx = null; state.activeIdx = null; updateNodeSelectionVisuals(ctx.outer, [], null, null); }
      const ancestors = getAncestors(node.id, state.nodes);
      if (ancestors && ancestors.length > 0) {
        state.focusedNodeId = ancestors[ancestors.length - 1];
        state.pendingFocusId = ancestors[ancestors.length - 1];
        ctx.render();
      }
      return;
    }

    if (e.key === 'ArrowUp' && !e.ctrlKey) {
      const onFirstLine = !(input.value.slice(0, input.selectionStart ?? 0).includes('\n'));
      if (!onFirstLine) return;
      e.preventDefault();
      if (state.anchorIdx !== null) { state.anchorIdx = null; state.activeIdx = null; updateNodeSelectionVisuals(ctx.outer, [], null, null); }
      const colIdx = parseInt(input.dataset.columnIndex ?? '0', 10);
      const colInputs = Array.from(ctx.outer.querySelectorAll<HTMLTextAreaElement>(`[data-nav-input][data-column-index="${colIdx}"]`))
        .filter(inp => inp.offsetParent !== null);
      const pos = colInputs.indexOf(input);
      if (pos > 0) colInputs[pos - 1].focus({ preventScroll: true });
      return;
    }

    if (e.key === 'ArrowDown' && !e.ctrlKey) {
      const onLastLine = !(input.value.slice(input.selectionStart ?? input.value.length).includes('\n'));
      if (!onLastLine) return;
      e.preventDefault();
      if (state.anchorIdx !== null) { state.anchorIdx = null; state.activeIdx = null; updateNodeSelectionVisuals(ctx.outer, [], null, null); }
      const colIdx = parseInt(input.dataset.columnIndex ?? '0', 10);
      const colInputs = Array.from(ctx.outer.querySelectorAll<HTMLTextAreaElement>(`[data-nav-input][data-column-index="${colIdx}"]`))
        .filter(inp => inp.offsetParent !== null);
      const pos = colInputs.indexOf(input);
      if (pos < colInputs.length - 1) colInputs[pos + 1].focus({ preventScroll: true });
      return;
    }
  };
};
