import type { TreeNode } from './ops';
import type { DefinitionEditorContext } from './types';
import {
  flatIds, findNode, findDedentTarget, getAncestors, cloneNodes, reassignIds, randomId,
  updateNodeSelectionVisuals,
} from './ops';

export const createKeydownHandler = (
  node: TreeNode,
  input: HTMLTextAreaElement,
  ctx: DefinitionEditorContext,
): (e: KeyboardEvent) => void => {
  return (e: KeyboardEvent) => {
    const { state } = ctx;
    const currentLoc = findNode(state.nodes, node.id);

    if (e.key === 'Enter') {
      e.preventDefault();
      state.anchorIdx = null; state.activeIdx = null;
      const cursorPos = input.selectionStart ?? input.value.length;
      const textBefore = input.value.slice(0, cursorPos);
      const textAfter = input.value.slice(cursorPos);
      const newNode: TreeNode = { id: randomId(), text: textAfter };
      if (currentLoc) {
        currentLoc.parent[currentLoc.index].text = textBefore;
        currentLoc.parent.splice(currentLoc.index + 1, 0, newNode);
      } else {
        state.nodes.push(newNode);
      }
      state.pendingFocusId = newNode.id;
      state.pendingFocusCursorPos = 0;
      ctx.scheduleSave();
      ctx.render();
      return;
    }

    if (e.key === 'Backspace' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      state.anchorIdx = null; state.activeIdx = null;
      const allIds = flatIds(state.nodes);
      const idx = allIds.indexOf(node.id);
      const prevId = idx > 0 ? allIds[idx - 1] : null;
      if (currentLoc) currentLoc.parent.splice(currentLoc.index, 1);
      state.pendingFocusId = prevId;
      ctx.scheduleSave();
      ctx.render();
      return;
    }

    if (e.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0 && input.value !== '') {
      e.preventDefault();
      state.anchorIdx = null; state.activeIdx = null;
      const allIds = flatIds(state.nodes);
      const idx = allIds.indexOf(node.id);
      if (idx === 0) return;
      const prevId = allIds[idx - 1];
      const prevLoc = findNode(state.nodes, prevId);
      if (!prevLoc) return;
      const prevNode = prevLoc.parent[prevLoc.index];
      const mergedCursorPos = prevNode.text.length;
      prevNode.text = prevNode.text + node.text;
      if (currentLoc) currentLoc.parent.splice(currentLoc.index, 1);
      state.pendingFocusId = prevId;
      state.pendingFocusCursorPos = mergedCursorPos;
      ctx.scheduleSave();
      ctx.render();
      return;
    }

    if (e.key === 'Backspace' && input.value === '') {
      e.preventDefault();
      state.anchorIdx = null; state.activeIdx = null;
      const allIds = flatIds(state.nodes);
      const idx = allIds.indexOf(node.id);
      const prevId = idx > 0 ? allIds[idx - 1] : null;
      if (currentLoc) currentLoc.parent.splice(currentLoc.index, 1);
      state.pendingFocusId = prevId;
      ctx.scheduleSave();
      ctx.render();
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
            const snode = sloc.parent[sloc.index];
            const prev = sloc.parent[sloc.index - 1];
            sloc.parent.splice(sloc.index, 1);
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
          const prev = currentLoc.parent[currentLoc.index - 1];
          currentLoc.parent.splice(currentLoc.index, 1);
          if (!prev.children) prev.children = [];
          prev.children.push(node);
          state.pendingFocusId = node.id;
          ctx.scheduleSave();
          ctx.render();
        }
      }
      return;
    }

    if (e.key === 'ArrowLeft' && e.altKey) {
      e.preventDefault();
      if (ctx.sourceComponentId) {
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
          state.pendingFocusId = focusTarget ?? null;
          ctx.scheduleSave();
          ctx.render();
          document.dispatchEvent(new CustomEvent('definition-editor:move-to-word', {
            detail: { sourceFrameId: ctx.sourceComponentId, nodes: moveNodes },
          }));
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
        if (allLoc) {
          if (currentLoc) currentLoc.parent.splice(currentLoc.index, 1);
          allLoc.parent.splice(allLoc.index + 1, 0, node);
          state.pendingFocusId = node.id;
          ctx.scheduleSave();
          ctx.render();
        }
      }
      return;
    }

    if (e.key === 'ArrowDown' && e.ctrlKey) {
      e.preventDefault();
      if (node.children?.length && state.collapsedIds.has(node.id)) {
        state.collapsedIds.delete(node.id);
        state.pendingFocusId = node.id;
        ctx.render();
      }
      return;
    }

    if (e.key === 'ArrowUp' && e.ctrlKey) {
      e.preventDefault();
      if (node.children?.length && !state.collapsedIds.has(node.id)) {
        state.collapsedIds.add(node.id);
        state.pendingFocusId = node.id;
        ctx.render();
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
      const newActiveIdx = Math.max(0, (state.activeIdx ?? idx) - 1);
      state.activeIdx = newActiveIdx;
      updateNodeSelectionVisuals(ctx.outer, allIds, state.anchorIdx, state.activeIdx);
      ctx.outer.querySelector<HTMLTextAreaElement>(`[data-node-id="${CSS.escape(allIds[newActiveIdx])}"]`)?.focus();
      return;
    }

    if (e.key === 'ArrowDown' && e.shiftKey) {
      e.preventDefault();
      const allIds = flatIds(state.nodes);
      const idx = allIds.indexOf(node.id);
      if (idx < 0) return;
      if (state.anchorIdx === null) state.anchorIdx = idx;
      const newActiveIdx = Math.min(allIds.length - 1, (state.activeIdx ?? idx) + 1);
      state.activeIdx = newActiveIdx;
      updateNodeSelectionVisuals(ctx.outer, allIds, state.anchorIdx, state.activeIdx);
      ctx.outer.querySelector<HTMLTextAreaElement>(`[data-node-id="${CSS.escape(allIds[newActiveIdx])}"]`)?.focus();
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
      if (e.key === 'x' && state.clipboard.length > 0) {
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
        state.pendingFocusId = focusTarget ?? null;
        ctx.scheduleSave();
        ctx.render();
      }
      return;
    }

    if (e.key === 'v' && e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (!state.clipboard || state.clipboard.length === 0) return;
      e.preventDefault();
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

    if (e.key === 'ArrowRight' && !e.altKey && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
      e.preventDefault();
      if (state.anchorIdx !== null) { state.anchorIdx = null; state.activeIdx = null; updateNodeSelectionVisuals(ctx.outer, [], null, null); }
      const navInputs = Array.from(ctx.outer.querySelectorAll<HTMLTextAreaElement>('[data-nav-input]'))
        .filter(inp => inp.offsetParent !== null);
      const idx = navInputs.indexOf(input);
      if (idx < navInputs.length - 1) navInputs[idx + 1].focus();
      return;
    }

    if (e.key === 'ArrowLeft' && !e.altKey && input.selectionStart === 0 && input.selectionEnd === 0) {
      e.preventDefault();
      if (state.anchorIdx !== null) { state.anchorIdx = null; state.activeIdx = null; updateNodeSelectionVisuals(ctx.outer, [], null, null); }
      const navInputs = Array.from(ctx.outer.querySelectorAll<HTMLTextAreaElement>('[data-nav-input]'))
        .filter(inp => inp.offsetParent !== null);
      const idx = navInputs.indexOf(input);
      if (idx > 0) {
        const prev = navInputs[idx - 1];
        prev.focus();
        prev.setSelectionRange(prev.value.length, prev.value.length);
      }
      return;
    }

    if (e.key === 'ArrowUp' && !e.ctrlKey) {
      const onFirstLine = !(input.value.slice(0, input.selectionStart ?? 0).includes('\n'));
      if (!onFirstLine) return;
      e.preventDefault();
      if (state.anchorIdx !== null) { state.anchorIdx = null; state.activeIdx = null; updateNodeSelectionVisuals(ctx.outer, [], null, null); }
      const navInputs = Array.from(ctx.outer.querySelectorAll<HTMLTextAreaElement>('[data-nav-input]'))
        .filter(inp => inp.offsetParent !== null);
      const idx = navInputs.indexOf(input);
      if (idx > 0) navInputs[idx - 1].focus();
      return;
    }

    if (e.key === 'ArrowDown' && !e.ctrlKey) {
      const onLastLine = !(input.value.slice(input.selectionStart ?? input.value.length).includes('\n'));
      if (!onLastLine) return;
      e.preventDefault();
      if (state.anchorIdx !== null) { state.anchorIdx = null; state.activeIdx = null; updateNodeSelectionVisuals(ctx.outer, [], null, null); }
      const navInputs = Array.from(ctx.outer.querySelectorAll<HTMLTextAreaElement>('[data-nav-input]'))
        .filter(inp => inp.offsetParent !== null);
      const idx = navInputs.indexOf(input);
      if (idx < navInputs.length - 1) navInputs[idx + 1].focus();
      return;
    }
  };
};
