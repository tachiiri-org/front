import type { KnowledgeEditorComponent } from '../../../schema/component/kind/knowledge-editor';
import type { TreeNode } from '../../../schema/component/kind/tree-editor';
import { ALL_CSS_PROP_KEYS } from '../../../schema/component';

const getByPath = (obj: unknown, path: string): unknown => {
  if (!path) return obj;
  return path.split('.').reduce((acc, key) => {
    if (acc !== null && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
};

const applyCssProps = (el: HTMLElement, c: Record<string, unknown>): void => {
  for (const propKey of ALL_CSS_PROP_KEYS) {
    const v = c[propKey];
    if (typeof v === 'string') (el.style as unknown as Record<string, string>)[propKey] = v;
  }
};

const randomId = (): string => {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  return `node_${Math.random().toString(36).slice(2, 10)}`;
};

const cloneNodes = (nodes: TreeNode[]): TreeNode[] =>
  JSON.parse(JSON.stringify(nodes)) as TreeNode[];

const flatIds = (nodes: TreeNode[]): string[] => {
  const ids: string[] = [];
  const traverse = (list: TreeNode[]): void => {
    for (const n of list) {
      ids.push(n.id);
      if (n.children?.length) traverse(n.children);
    }
  };
  traverse(nodes);
  return ids;
};

type NodeLocation = { parent: TreeNode[]; index: number };

const findNode = (nodes: TreeNode[], id: string): NodeLocation | null => {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { parent: nodes, index: i };
    const children = nodes[i].children;
    if (children) {
      const found = findNode(children, id);
      if (found) return found;
    }
  }
  return null;
};

const findDedentTarget = (list: TreeNode[], id: string, parentList: TreeNode[] | null = null, parentItemIndex = -1): NodeLocation | null => {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      if (parentList !== null) return { parent: parentList, index: parentItemIndex };
      return null;
    }
    const children = list[i].children;
    if (children) {
      const found = findDedentTarget(children, id, list, i);
      if (found) return found;
    }
  }
  return null;
};

const getAncestors = (id: string, list: TreeNode[], ancestors: string[] = []): string[] | null => {
  for (const n of list) {
    if (n.id === id) return ancestors;
    if (n.children) {
      const found = getAncestors(id, n.children, [...ancestors, n.id]);
      if (found !== null) return found;
    }
  }
  return null;
};

const reassignIds = (nodeList: TreeNode[]): TreeNode[] =>
  nodeList.map(n => ({
    ...n,
    id: randomId(),
    children: n.children?.length ? reassignIds(n.children) : n.children,
  }));

const hasDescendants = (node: TreeNode): { issue: boolean; proposed: boolean } => {
  let issue = false, proposed = false;
  const check = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.type === 'issue' || n.text.startsWith('?')) issue = true;
      else if (n.status === 'proposed') proposed = true;
      if (n.children?.length) check(n.children);
    }
  };
  check(node.children ?? []);
  return { issue, proposed };
};

const dispatchNodeFocus = (knowledgeEditorFrameId: string, nodeId: string, nodeText: string): void => {
  document.dispatchEvent(new CustomEvent('knowledge-editor:node-focus', {
    detail: { knowledgeEditorFrameId, nodeId, nodeText },
  }));
};

const dispatchNodeTextChange = (knowledgeEditorFrameId: string, nodeId: string, nodeText: string): void => {
  document.dispatchEvent(new CustomEvent('knowledge-editor:node-text-change', {
    detail: { knowledgeEditorFrameId, nodeId, nodeText },
  }));
};

const updateNodeSelectionVisuals = (
  container: HTMLElement,
  allIds: string[],
  anchorIdx: number | null,
  activeIdx: number | null,
): void => {
  const lo = anchorIdx !== null && activeIdx !== null ? Math.min(anchorIdx, activeIdx) : -1;
  const hi = anchorIdx !== null && activeIdx !== null ? Math.max(anchorIdx, activeIdx) : -1;
  const rows = container.querySelectorAll<HTMLElement>('[data-node-row]');
  for (const row of rows) {
    const idx = allIds.indexOf(row.dataset.nodeRow ?? '');
    if (lo >= 0 && idx >= lo && idx <= hi) {
      row.style.background = 'rgba(0, 120, 255, 0.12)';
    } else {
      row.style.background = row.dataset.inPath === 'true' ? 'rgba(0, 120, 255, 0.08)' : 'transparent';
    }
  }
};

export const renderKnowledgeEditor = (
  id: string,
  component: KnowledgeEditorComponent,
  treeId?: string,
): HTMLElement => {
  const outer = document.createElement('div');
  outer.dataset.frameId = id;
  outer.style.overflow = 'hidden';
  outer.style.display = 'flex';
  outer.style.flexDirection = 'column';
  outer.style.boxSizing = 'border-box';
  outer.style.fontSize = '13px';
  outer.style.lineHeight = '1.5';
  applyCssProps(outer, component as unknown as Record<string, unknown>);

  let nodes: TreeNode[] = cloneNodes(component.data.nodes);
  let pendingFocusId: string | null = null;
  let focusedNodeId: string | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let rafId: number | null = null;
  let anchorIdx: number | null = null;
  let activeIdx: number | null = null;
  let mousedownNodeId: string | null = null;
  let pendingSelectionStart: number | null = null;
  let resolvedTreeId = treeId;
  let renderTarget: HTMLElement = outer;
  let clipboard: TreeNode[] | null = null;
  const history: TreeNode[][] = [];
  const inputCache = new Map<string, HTMLTextAreaElement>();
  let activeDocNodeId: string | null = null;
  const docContentCache = new Map<string, string>();

  const syncOuterWidth = (): void => {
    if (activeDocNodeId !== null) {
      requestAnimationFrame(() => {
        const docEl = document.querySelector<HTMLElement>(
          `[data-source-component-id="${CSS.escape(id)}"]`,
        );
        if (docEl) {
          const docRect = docEl.getBoundingClientRect();
          const outerRect = outer.getBoundingClientRect();
          if (docRect.width > 0) {
            outer.style.width = `${docRect.left - outerRect.left}px`;
            scrollColumnsToEnd();
            return;
          }
        }
        outer.style.width = '';
      });
    } else {
      outer.style.width = '';
    }
  };

  const scheduleRender = (): void => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      render();
    });
  };

  const createInput = (node: TreeNode): HTMLTextAreaElement => {
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
      if (focusedNodeId !== node.id) {
        const fromMouse = mousedownNodeId === node.id;
        mousedownNodeId = null;
        focusedNodeId = node.id;
        dispatchNodeFocus(id, node.id, input.value);
        pendingFocusId = node.id;
        if (fromMouse) {
          pendingSelectionStart = input.selectionStart;
          render();
        } else {
          scheduleRender();
        }
      }
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
      if (input.value === '?') {
        const loc = findNode(nodes, node.id);
        if (loc) {
          loc.parent[loc.index].type = 'issue';
          loc.parent[loc.index].text = '';
          input.value = '';
          inputCache.delete(node.id);
          pendingFocusId = node.id;
          scheduleSave();
          render();
        }
        return;
      }
      const loc = findNode(nodes, node.id);
      if (loc) {
        loc.parent[loc.index].text = input.value;
        if (focusedNodeId === node.id) dispatchNodeTextChange(id, node.id, input.value);
        scheduleSave();
      }
    });

    input.addEventListener('mousedown', (e: MouseEvent) => {
      mousedownNodeId = node.id;
      if (e.shiftKey) {
        e.preventDefault();
        const allIds = flatIds(nodes);
        const idx = allIds.indexOf(node.id);
        if (anchorIdx === null) anchorIdx = idx;
        activeIdx = idx;
        updateNodeSelectionVisuals(outer, allIds, anchorIdx, activeIdx);
        return;
      }
      if (anchorIdx === null) return;
      anchorIdx = null;
      activeIdx = null;
      updateNodeSelectionVisuals(outer, [], null, null);
    });

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      const currentLoc = findNode(nodes, node.id);
      const currentNode = currentLoc ? currentLoc.parent[currentLoc.index] : null;
      const currentIsProposed = currentNode?.status === 'proposed';

      if (e.key === 'Enter' && e.ctrlKey && currentIsProposed) {
        e.preventDefault();
        pushHistory();
        if (currentNode) {
          currentNode.status = 'accepted';
          delete currentNode.proposedAt;
          delete currentNode.proposedBy;
        }
        const allIds = flatIds(nodes);
        const idx = allIds.indexOf(node.id);
        pendingFocusId = idx < allIds.length - 1 ? allIds[idx + 1] : node.id;
        scheduleSave();
        render();
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey && !e.ctrlKey && !e.altKey) {
          const allIds = flatIds(nodes);
          let selIds: string[];
          if (anchorIdx !== null && activeIdx !== null) {
            const lo = Math.min(anchorIdx, activeIdx);
            const hi = Math.max(anchorIdx, activeIdx);
            selIds = allIds.slice(lo, hi + 1);
          } else {
            selIds = [node.id];
          }
          const insertNodes = selIds.map(sid => {
            const loc = findNode(nodes, sid);
            return loc ? loc.parent[loc.index] : null;
          }).filter((n): n is TreeNode => n !== null);
          if (insertNodes.length > 0) {
            document.dispatchEvent(new CustomEvent('knowledge-editor:insert-to-doc', {
              detail: { knowledgeEditorFrameId: id, nodes: insertNodes },
            }));
          }
          return;
        }
        pushHistory();
        anchorIdx = null; activeIdx = null;
        const cursor = input.selectionStart ?? input.value.length;
        const tail = input.value.slice(cursor);
        const newNode: TreeNode = { id: randomId(), text: tail };
        if (currentLoc) {
          currentLoc.parent[currentLoc.index].text = input.value.slice(0, cursor);
          input.value = input.value.slice(0, cursor);
          currentLoc.parent.splice(currentLoc.index + 1, 0, newNode);
        } else {
          nodes.push(newNode);
        }
        pendingFocusId = newNode.id;
        scheduleSave();
        render();
        return;
      }

      if (e.key === 'Backspace' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        pushHistory();
        anchorIdx = null; activeIdx = null;
        const allIds = flatIds(nodes);
        const idx = allIds.indexOf(node.id);
        const prevId = idx > 0 ? allIds[idx - 1] : null;
        if (currentLoc) currentLoc.parent.splice(currentLoc.index, 1);
        focusedNodeId = prevId;
        pendingFocusId = prevId;
        scheduleSave();
        render();
        return;
      }

      if (e.key === 'Backspace' && input.value === '') {
        e.preventDefault();
        pushHistory();
        anchorIdx = null; activeIdx = null;
        const allIds = flatIds(nodes);
        const idx = allIds.indexOf(node.id);
        const prevId = idx > 0 ? allIds[idx - 1] : null;
        if (currentLoc) currentLoc.parent.splice(currentLoc.index, 1);
        focusedNodeId = prevId;
        pendingFocusId = prevId;
        scheduleSave();
        render();
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        if (activeDocNodeId !== null) {
          const allIds = flatIds(nodes);
          let selIds: string[];
          if (anchorIdx !== null && activeIdx !== null) {
            const lo = Math.min(anchorIdx, activeIdx);
            const hi = Math.max(anchorIdx, activeIdx);
            selIds = allIds.slice(lo, hi + 1);
          } else {
            selIds = [node.id];
          }
          const idSet = new Set(selIds);
          const topLevelSelIds = selIds.filter(sid => {
            const ancestors = getAncestors(sid, nodes);
            return ancestors !== null && !ancestors.some(a => idSet.has(a));
          });
          const moveNodes = topLevelSelIds.map(sid => {
            const loc = findNode(nodes, sid);
            return loc ? cloneNodes([loc.parent[loc.index]])[0] : null;
          }).filter((n): n is TreeNode => n !== null);
          if (moveNodes.length > 0) {
            document.dispatchEvent(new CustomEvent('knowledge-editor:insert-to-doc', {
              detail: { knowledgeEditorFrameId: id, nodes: moveNodes },
            }));
            pushHistory();
            const firstFlatIdx = allIds.indexOf(selIds[0]);
            for (const sid of [...topLevelSelIds].reverse()) {
              const loc = findNode(nodes, sid);
              if (loc) loc.parent.splice(loc.index, 1);
            }
            anchorIdx = null; activeIdx = null;
            const newAllIds = flatIds(nodes);
            const focusTarget = firstFlatIdx > 0
              ? newAllIds[Math.min(firstFlatIdx - 1, newAllIds.length - 1)]
              : newAllIds[0];
            focusedNodeId = focusTarget ?? null;
            pendingFocusId = focusTarget ?? null;
            scheduleSave();
            render();
          }
          return;
        }
      }

      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        pushHistory();
        if (anchorIdx !== null && activeIdx !== null) {
          const allIds = flatIds(nodes);
          const lo = Math.min(anchorIdx, activeIdx);
          const hi = Math.max(anchorIdx, activeIdx);
          const selIds = allIds.slice(lo, hi + 1);
          for (const sid of selIds) {
            const sloc = findNode(nodes, sid);
            if (sloc && sloc.index > 0) {
              const snode = sloc.parent.splice(sloc.index, 1)[0];
              const prev = sloc.parent[sloc.index - 1];
              if (!prev.children) prev.children = [];
              prev.children.push(snode);
            }
          }
          pendingFocusId = node.id;
          scheduleSave();
          render();
          const newAllIds = flatIds(nodes);
          const newLo = newAllIds.indexOf(selIds[0]);
          const newHi = newAllIds.indexOf(selIds[selIds.length - 1]);
          const wasAsc = anchorIdx <= activeIdx;
          anchorIdx = wasAsc ? newLo : newHi;
          activeIdx = wasAsc ? newHi : newLo;
          updateNodeSelectionVisuals(outer, newAllIds, anchorIdx, activeIdx);
        } else {
          anchorIdx = null; activeIdx = null;
          if (currentLoc && currentLoc.index > 0) {
            const snode = currentLoc.parent.splice(currentLoc.index, 1)[0];
            const prev = currentLoc.parent[currentLoc.index - 1];
            if (!prev.children) prev.children = [];
            prev.children.push(snode);
            pendingFocusId = node.id;
            scheduleSave();
            render();
          }
        }
        return;
      }

      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        pushHistory();
        if (anchorIdx !== null && activeIdx !== null) {
          const allIds = flatIds(nodes);
          const lo = Math.min(anchorIdx, activeIdx);
          const hi = Math.max(anchorIdx, activeIdx);
          const selIds = allIds.slice(lo, hi + 1);
          for (const sid of [...selIds].reverse()) {
            const allLoc = findDedentTarget(nodes, sid);
            if (allLoc) {
              const sloc = findNode(nodes, sid);
              if (sloc) {
                const snode = sloc.parent.splice(sloc.index, 1)[0];
                allLoc.parent.splice(allLoc.index + 1, 0, snode);
              }
            }
          }
          pendingFocusId = node.id;
          scheduleSave();
          render();
          const newAllIds = flatIds(nodes);
          const newLo = newAllIds.indexOf(selIds[0]);
          const newHi = newAllIds.indexOf(selIds[selIds.length - 1]);
          const wasAsc = anchorIdx <= activeIdx;
          anchorIdx = wasAsc ? newLo : newHi;
          activeIdx = wasAsc ? newHi : newLo;
          updateNodeSelectionVisuals(outer, newAllIds, anchorIdx, activeIdx);
        } else {
          anchorIdx = null; activeIdx = null;
          const allLoc = findDedentTarget(nodes, node.id);
          if (allLoc && currentLoc) {
            const snode = currentLoc.parent.splice(currentLoc.index, 1)[0];
            allLoc.parent.splice(allLoc.index + 1, 0, snode);
            pendingFocusId = node.id;
            scheduleSave();
            render();
          }
        }
        return;
      }

      if (e.key === 'ArrowUp' && e.shiftKey && e.altKey) {
        e.preventDefault();
        if (anchorIdx !== null && activeIdx !== null) {
          const allIds = flatIds(nodes);
          const lo = Math.min(anchorIdx, activeIdx);
          const hi = Math.max(anchorIdx, activeIdx);
          const selIds = allIds.slice(lo, hi + 1);
          const firstLoc = findNode(nodes, selIds[0]);
          if (firstLoc && firstLoc.index > 0 && selIds.every((sid, i) => firstLoc.parent[firstLoc.index + i]?.id === sid)) {
            pushHistory();
            const block = firstLoc.parent.splice(firstLoc.index, selIds.length);
            firstLoc.parent.splice(firstLoc.index - 1, 0, ...block);
            scheduleSave();
            const wasAsc = anchorIdx <= activeIdx;
            render();
            const newAllIds = flatIds(nodes);
            const newLo = newAllIds.indexOf(selIds[0]);
            const newHi = newAllIds.indexOf(selIds[selIds.length - 1]);
            anchorIdx = wasAsc ? newLo : newHi;
            activeIdx = wasAsc ? newHi : newLo;
            updateNodeSelectionVisuals(outer, newAllIds, anchorIdx, activeIdx);
          }
        } else {
          anchorIdx = null; activeIdx = null;
          if (currentLoc && currentLoc.index > 0) {
            pushHistory();
            const tmp = currentLoc.parent[currentLoc.index - 1];
            currentLoc.parent[currentLoc.index - 1] = currentLoc.parent[currentLoc.index];
            currentLoc.parent[currentLoc.index] = tmp;
            pendingFocusId = node.id;
            scheduleSave();
            render();
          }
        }
        return;
      }

      if (e.key === 'ArrowDown' && e.shiftKey && e.altKey) {
        e.preventDefault();
        if (anchorIdx !== null && activeIdx !== null) {
          const allIds = flatIds(nodes);
          const lo = Math.min(anchorIdx, activeIdx);
          const hi = Math.max(anchorIdx, activeIdx);
          const selIds = allIds.slice(lo, hi + 1);
          const firstLoc = findNode(nodes, selIds[0]);
          if (firstLoc && firstLoc.index + selIds.length < firstLoc.parent.length && selIds.every((sid, i) => firstLoc.parent[firstLoc.index + i]?.id === sid)) {
            pushHistory();
            const block = firstLoc.parent.splice(firstLoc.index, selIds.length);
            firstLoc.parent.splice(firstLoc.index + 1, 0, ...block);
            scheduleSave();
            const wasAsc = anchorIdx <= activeIdx;
            render();
            const newAllIds = flatIds(nodes);
            const newLo = newAllIds.indexOf(selIds[0]);
            const newHi = newAllIds.indexOf(selIds[selIds.length - 1]);
            anchorIdx = wasAsc ? newLo : newHi;
            activeIdx = wasAsc ? newHi : newLo;
            updateNodeSelectionVisuals(outer, newAllIds, anchorIdx, activeIdx);
          }
        } else {
          anchorIdx = null; activeIdx = null;
          if (currentLoc && currentLoc.index < currentLoc.parent.length - 1) {
            pushHistory();
            const tmp = currentLoc.parent[currentLoc.index + 1];
            currentLoc.parent[currentLoc.index + 1] = currentLoc.parent[currentLoc.index];
            currentLoc.parent[currentLoc.index] = tmp;
            pendingFocusId = node.id;
            scheduleSave();
            render();
          }
        }
        return;
      }

      if (e.key === 'ArrowUp' && e.shiftKey) {
        e.preventDefault();
        const allIds = flatIds(nodes);
        const idx = allIds.indexOf(node.id);
        if (idx < 0) return;
        if (anchorIdx === null) anchorIdx = idx;
        const colIdx = parseInt(input.dataset.columnIndex ?? '0', 10);
        const colInputs = Array.from(outer.querySelectorAll<HTMLTextAreaElement>(`[data-nav-input][data-column-index="${colIdx}"]`))
          .filter(inp => inp.offsetParent !== null);
        const colPos = colInputs.indexOf(input);
        if (colPos <= 0) return;
        const prevInput = colInputs[colPos - 1];
        const newActiveIdx = allIds.indexOf(prevInput.dataset.nodeId ?? '');
        activeIdx = newActiveIdx;
        prevInput.focus();
        updateNodeSelectionVisuals(outer, allIds, anchorIdx, activeIdx);
        return;
      }

      if (e.key === 'ArrowDown' && e.shiftKey) {
        e.preventDefault();
        const allIds = flatIds(nodes);
        const idx = allIds.indexOf(node.id);
        if (idx < 0) return;
        if (anchorIdx === null) anchorIdx = idx;
        const colIdx = parseInt(input.dataset.columnIndex ?? '0', 10);
        const colInputs = Array.from(outer.querySelectorAll<HTMLTextAreaElement>(`[data-nav-input][data-column-index="${colIdx}"]`))
          .filter(inp => inp.offsetParent !== null);
        const colPos = colInputs.indexOf(input);
        if (colPos >= colInputs.length - 1) return;
        const nextInput = colInputs[colPos + 1];
        const newActiveIdx = allIds.indexOf(nextInput.dataset.nodeId ?? '');
        activeIdx = newActiveIdx;
        nextInput.focus();
        updateNodeSelectionVisuals(outer, allIds, anchorIdx, activeIdx);
        return;
      }

      if (e.key === 'z' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (history.length > 0) {
          nodes = history.pop()!;
          anchorIdx = null; activeIdx = null;
          scheduleSave();
          render();
        }
        return;
      }

      if ((e.key === 'c' || e.key === 'x') && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const allIds = flatIds(nodes);
        let selIds: string[];
        if (anchorIdx !== null && activeIdx !== null) {
          const lo = Math.min(anchorIdx, activeIdx);
          const hi = Math.max(anchorIdx, activeIdx);
          selIds = allIds.slice(lo, hi + 1);
        } else {
          selIds = [node.id];
        }
        const idSet = new Set(selIds);
        const topLevelSelIds = selIds.filter(sid => {
          const ancestors = getAncestors(sid, nodes);
          return ancestors !== null && !ancestors.some(a => idSet.has(a));
        });
        clipboard = topLevelSelIds.map(sid => {
          const loc = findNode(nodes, sid);
          return loc ? cloneNodes([loc.parent[loc.index]])[0] : null;
        }).filter((n): n is TreeNode => n !== null);
        if (clipboard.length > 0) {
          const toText = (list: TreeNode[], depth: number): string =>
            list.map(n => {
              const line = '  '.repeat(depth) + n.text;
              return n.children?.length ? line + '\n' + toText(n.children, depth + 1) : line;
            }).join('\n');
          void navigator.clipboard.writeText(toText(clipboard, 0)).catch(() => undefined);
        }
        if (e.key === 'x' && clipboard.length > 0) {
          pushHistory();
          const firstFlatIdx = allIds.indexOf(selIds[0]);
          const parentLoc = (() => {
            for (const sid of topLevelSelIds) {
              const ancestors = getAncestors(sid, nodes);
              if (ancestors && ancestors.length > 0) return ancestors[ancestors.length - 1];
            }
            return null;
          })();
          for (const sid of [...topLevelSelIds].reverse()) {
            const loc = findNode(nodes, sid);
            if (loc) loc.parent.splice(loc.index, 1);
          }
          anchorIdx = null; activeIdx = null;
          const newAllIds = flatIds(nodes);
          const focusTarget = parentLoc && newAllIds.includes(parentLoc)
            ? parentLoc
            : firstFlatIdx > 0
            ? newAllIds[Math.min(firstFlatIdx - 1, newAllIds.length - 1)]
            : newAllIds[0];
          focusedNodeId = focusTarget ?? null;
          pendingFocusId = focusTarget ?? null;
          scheduleSave();
          render();
        }
        return;
      }

      if (e.key === 'v' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (!clipboard || clipboard.length === 0) return;
        pushHistory();
        const pasted = reassignIds(clipboard);
        if (currentLoc) {
          currentLoc.parent.splice(currentLoc.index + 1, 0, ...pasted);
        } else {
          nodes.push(...pasted);
        }
        anchorIdx = null; activeIdx = null;
        pendingFocusId = pasted[0].id;
        scheduleSave();
        render();
        return;
      }

      if (e.key === 'ArrowRight' && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
        e.preventDefault();
        if (anchorIdx !== null) { anchorIdx = null; activeIdx = null; updateNodeSelectionVisuals(outer, [], null, null); }
        if (currentNode?.children?.length) {
          focusedNodeId = currentNode.children[0].id;
          pendingFocusId = currentNode.children[0].id;
          render();
        }
        return;
      }

      if (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) {
        e.preventDefault();
        if (anchorIdx !== null) { anchorIdx = null; activeIdx = null; updateNodeSelectionVisuals(outer, [], null, null); }
        const ancestors = getAncestors(node.id, nodes);
        if (ancestors && ancestors.length > 0) {
          focusedNodeId = ancestors[ancestors.length - 1];
          pendingFocusId = ancestors[ancestors.length - 1];
          render();
        }
        return;
      }

      if (e.key === 'ArrowUp' && !e.ctrlKey) {
        const onFirstLine = !(input.value.slice(0, input.selectionStart ?? 0).includes('\n'));
        if (!onFirstLine) return;
        e.preventDefault();
        if (anchorIdx !== null) { anchorIdx = null; activeIdx = null; updateNodeSelectionVisuals(outer, [], null, null); }
        const colIdx = parseInt(input.dataset.columnIndex ?? '0', 10);
        const colInputs = Array.from(outer.querySelectorAll<HTMLTextAreaElement>(`[data-nav-input][data-column-index="${colIdx}"]`))
          .filter(inp => inp.offsetParent !== null);
        const pos = colInputs.indexOf(input);
        if (pos > 0) colInputs[pos - 1].focus();
        return;
      }

      if (e.key === 'ArrowDown' && !e.ctrlKey) {
        const onLastLine = !(input.value.slice(input.selectionStart ?? input.value.length).includes('\n'));
        if (!onLastLine) return;
        e.preventDefault();
        if (anchorIdx !== null) { anchorIdx = null; activeIdx = null; updateNodeSelectionVisuals(outer, [], null, null); }
        const colIdx = parseInt(input.dataset.columnIndex ?? '0', 10);
        const colInputs = Array.from(outer.querySelectorAll<HTMLTextAreaElement>(`[data-nav-input][data-column-index="${colIdx}"]`))
          .filter(inp => inp.offsetParent !== null);
        const pos = colInputs.indexOf(input);
        if (pos < colInputs.length - 1) colInputs[pos + 1].focus();
        return;
      }
    });

    return input;
  };

  const fetchDocContent = (nodeId: string): void => {
    void fetch(`/api/docs/${encodeURIComponent(nodeId)}`)
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : Promise.resolve(null)))
      .then((data) => {
        const content =
          typeof (data as Record<string, unknown> | null)?.content === 'string'
            ? ((data as Record<string, unknown>).content as string)
            : '';
        docContentCache.set(nodeId, content);
        render();
      })
      .catch(() => {
        docContentCache.set(nodeId, '');
        render();
      });
  };

  const scheduleSave = (): void => {
    if (!resolvedTreeId) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void fetch(`/api/trees/${encodeURIComponent(resolvedTreeId!)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes }),
      });
    }, 500);
  };

  const pushHistory = (): void => {
    history.push(cloneNodes(nodes));
    if (history.length > 50) history.shift();
  };

  const focusPending = (): void => {
    if (!pendingFocusId) return;
    const fid = pendingFocusId;
    pendingFocusId = null;
    const el = outer.querySelector<HTMLTextAreaElement>(`[data-node-id="${CSS.escape(fid)}"]`);
    if (!el) return;
    el.focus();
    if (pendingSelectionStart !== null) {
      el.setSelectionRange(pendingSelectionStart, pendingSelectionStart);
      pendingSelectionStart = null;
    }
  };

  const buildColumn = (list: TreeNode[], fullPath: string[], columnIndex: number, onAdd: (text: string) => void): HTMLElement => {
    const col = document.createElement('div');
    col.style.width = 'max-content';
    col.style.maxWidth = '30vw';
    col.style.minWidth = '180px';
    col.style.borderRight = '1px solid rgba(0,0,0,0.2)';
    col.style.overflowY = 'auto';
    col.style.overflowX = 'hidden';
    col.style.flexShrink = '0';
    col.style.boxSizing = 'border-box';
    col.style.padding = '4px 0';

    const draftRow = document.createElement('div');
    draftRow.style.display = 'flex';
    draftRow.style.alignItems = 'flex-start';
    draftRow.style.gap = '4px';
    draftRow.style.padding = '1px 8px 1px 12px';

    const draftMarker = document.createElement('span');
    Object.assign(draftMarker.style, {
      width: '6px',
      height: '6px',
      flexShrink: '0',
      alignSelf: 'center',
      borderRadius: '1px',
      boxSizing: 'border-box',
      background: 'transparent',
      border: '1.5px solid rgba(0,0,0,0.2)',
    });

    const draftInput = document.createElement('textarea');
    draftInput.rows = 1;
    draftInput.dataset.navInput = 'draft';
    draftInput.dataset.columnIndex = String(columnIndex);
    Object.assign(draftInput.style, {
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
      color: 'rgba(0,0,0,0.35)',
    });
    (draftInput.style as unknown as Record<string, string>)['field-sizing'] = 'content';

    draftInput.addEventListener('input', () => {
      draftInput.style.height = 'auto';
      draftInput.style.height = `${draftInput.scrollHeight}px`;
    });

    draftInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = draftInput.value;
        if (!text) return;
        pushHistory();
        onAdd(text);
        draftInput.value = '';
        draftInput.style.height = 'auto';
        return;
      }
      if (e.key === 'ArrowDown') {
        const onLastLine = !(draftInput.value.slice(draftInput.selectionStart ?? draftInput.value.length).includes('\n'));
        if (!onLastLine) return;
        e.preventDefault();
        const colInputs = Array.from(outer.querySelectorAll<HTMLTextAreaElement>(`[data-nav-input][data-column-index="${columnIndex}"]`))
          .filter(inp => inp.offsetParent !== null);
        const pos = colInputs.indexOf(draftInput);
        if (pos < colInputs.length - 1) colInputs[pos + 1].focus();
      }
    });

    draftRow.appendChild(draftMarker);
    draftRow.appendChild(draftInput);
    col.appendChild(draftRow);

    for (const node of list) {
      const isSelectedInPath = fullPath[columnIndex] === node.id;
      const isProposed = node.status === 'proposed';
      const isIssue = node.type === 'issue' || node.text.startsWith('?');
      const desc = hasDescendants(node);

      const row = document.createElement('div');
      row.dataset.nodeRow = node.id;
      row.dataset.inPath = isSelectedInPath ? 'true' : 'false';
      row.style.display = 'flex';
      row.style.alignItems = 'flex-start';
      row.style.gap = '4px';
      row.style.padding = '1px 8px 1px 12px';
      row.style.background = isSelectedInPath ? 'rgba(0, 120, 255, 0.08)' : 'transparent';

      let input = inputCache.get(node.id);
      if (!input) {
        input = createInput(node);
        inputCache.set(node.id, input);
      }
      if (input.value !== node.text) input.value = node.text;
      input.dataset.columnIndex = String(columnIndex);
      input.style.background = isIssue ? 'rgba(255, 160, 0, 0.07)' : isProposed ? 'rgba(0, 160, 80, 0.07)' : 'transparent';
      input.style.color = isIssue ? 'rgba(160, 80, 0, 0.85)' : isProposed ? 'rgba(0, 100, 50, 0.85)' : 'inherit';
      input.style.fontStyle = isProposed ? 'italic' : 'normal';
      input.style.borderRadius = isIssue || isProposed ? '3px' : '0';

      const marker = document.createElement('span');
      const isDocOpen = activeDocNodeId === node.id;
      const hasDoc = docContentCache.has(node.id) && docContentCache.get(node.id) !== '';
      const baseColor = isDocOpen
        ? 'rgba(0, 120, 255, 0.7)'
        : desc.issue
        ? 'rgba(255, 160, 0, 0.65)'
        : desc.proposed
        ? 'rgba(0, 160, 80, 0.65)'
        : isIssue
        ? 'rgba(255, 160, 0, 0.4)'
        : isProposed
        ? 'rgba(0, 160, 80, 0.4)'
        : 'rgba(0, 0, 0, 0.55)';
      Object.assign(marker.style, {
        width: '6px',
        height: '6px',
        flexShrink: '0',
        alignSelf: 'center',
        borderRadius: '1px',
        cursor: 'pointer',
        boxSizing: 'border-box',
        background: hasDoc ? baseColor : 'transparent',
        border: hasDoc ? 'none' : `1.5px solid ${baseColor}`,
        outline: isDocOpen ? '2px solid rgba(0, 120, 255, 0.3)' : 'none',
        outlineOffset: '1px',
      });
      marker.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (activeDocNodeId === node.id) {
          activeDocNodeId = null;
          document.dispatchEvent(new CustomEvent('knowledge-editor:doc-toggle', {
            detail: { knowledgeEditorFrameId: id, nodeId: null, nodeText: null },
          }));
        } else {
          activeDocNodeId = node.id;
          if (!docContentCache.has(node.id)) fetchDocContent(node.id);
          document.dispatchEvent(new CustomEvent('knowledge-editor:doc-toggle', {
            detail: { knowledgeEditorFrameId: id, nodeId: node.id, nodeText: node.text },
          }));
        }
        render();
        syncOuterWidth();
      });
      row.appendChild(marker);
      row.appendChild(input);

      if (node.children?.length) {
        const arrow = document.createElement('span');
        arrow.textContent = '›';
        Object.assign(arrow.style, {
          userSelect: 'none',
          color: isIssue ? 'rgba(160, 80, 0, 0.5)' : isProposed ? 'rgba(0, 100, 50, 0.5)' : 'rgba(0,0,0,0.25)',
          fontSize: '14px',
          flexShrink: '0',
          paddingRight: '2px',
        });
        row.appendChild(arrow);
      }

      col.appendChild(row);
    }

    return col;
  };

  const buildColumns = (): HTMLElement => {
    const fullPath: string[] = focusedNodeId
      ? [...(getAncestors(focusedNodeId, nodes) ?? []), focusedNodeId]
      : [];

    const colEls: HTMLElement[] = [];

    const wrapper = document.createElement('div');
    wrapper.dataset.columnsWrapper = 'true';
    wrapper.style.display = 'flex';
    wrapper.style.flex = '1';
    wrapper.style.minHeight = '0';
    wrapper.style.overflowX = 'auto';

    const rootCol = buildColumn(nodes, fullPath, 0, (text) => {
      const newNode: TreeNode = { id: randomId(), text };
      nodes.unshift(newNode);
      pendingFocusId = newNode.id;
      scheduleSave();
      render();
    });
    colEls.push(rootCol);
    wrapper.appendChild(rootCol);

    for (let i = 0; i < fullPath.length; i++) {
      const loc = findNode(nodes, fullPath[i]);
      if (!loc) break;
      const selected = loc.parent[loc.index];
      const isLastInPath = i === fullPath.length - 1;
      if (selected.children?.length || isLastInPath) {
        const col = buildColumn(selected.children ?? [], fullPath, i + 1, (text) => {
          const newNode: TreeNode = { id: randomId(), text };
          if (!selected.children) selected.children = [];
          selected.children.unshift(newNode);
          pendingFocusId = newNode.id;
          scheduleSave();
          render();
        });
        colEls.push(col);
        wrapper.appendChild(col);
      }
    }

    const makeBreadcrumbItem = (label: string, colIdx: number, isCurrent: boolean): HTMLElement => {
      const item = document.createElement('span');
      item.textContent = label.length > 24 ? `${label.slice(0, 24)}…` : label;
      item.style.cursor = 'pointer';
      item.style.color = isCurrent ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.4)';
      item.style.padding = '1px 2px';
      item.style.borderRadius = '2px';
      item.style.flexShrink = '0';
      item.addEventListener('click', () => {
        const col = colEls[colIdx];
        if (col) wrapper.scrollTo({ left: col.offsetLeft, behavior: 'smooth' });
      });
      return item;
    };

    const breadcrumb = document.createElement('div');
    Object.assign(breadcrumb.style, {
      display: 'flex',
      alignItems: 'center',
      flexShrink: '0',
      overflowX: 'auto',
      padding: '2px 8px',
      fontSize: '11px',
      borderBottom: '1px solid rgba(0,0,0,0.08)',
      gap: '2px',
      userSelect: 'none',
      whiteSpace: 'nowrap',
    });

    breadcrumb.appendChild(makeBreadcrumbItem('≡', 0, fullPath.length === 0));

    for (let i = 0; i < fullPath.length; i++) {
      const loc = findNode(nodes, fullPath[i]);
      if (!loc) break;
      const sep = document.createElement('span');
      sep.textContent = '›';
      sep.style.color = 'rgba(0,0,0,0.25)';
      sep.style.flexShrink = '0';
      breadcrumb.appendChild(sep);
      breadcrumb.appendChild(makeBreadcrumbItem(loc.parent[loc.index].text, i + 1, i === fullPath.length - 1));
    }

    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.flex = '1';
    container.style.minHeight = '0';
    container.appendChild(breadcrumb);
    container.appendChild(wrapper);

    return container;
  };

  document.addEventListener('document-editor:closed', (e: Event) => {
    const detail = (e as CustomEvent<{ sourceFrameId: string }>).detail;
    if (detail.sourceFrameId !== id) return;
    activeDocNodeId = null;
    render();
    syncOuterWidth();
  });

  document.addEventListener('document-editor:move-to-knowledge', (e: Event) => {
    const detail = (e as CustomEvent<{ sourceFrameId: string; nodes: TreeNode[] }>).detail;
    if (detail.sourceFrameId !== id) return;
    pushHistory();
    const newNodes = reassignIds(detail.nodes);
    const loc = focusedNodeId ? findNode(nodes, focusedNodeId) : null;
    if (loc) {
      loc.parent.splice(loc.index + 1, 0, ...newNodes);
    } else {
      nodes.push(...newNodes);
    }
    anchorIdx = null; activeIdx = null;
    pendingFocusId = newNodes[0].id;
    scheduleSave();
    render();
  });

  const scrollColumnsToEnd = (): void => {
    const columnsWrapper = outer.querySelector<HTMLElement>('[data-columns-wrapper]');
    if (!columnsWrapper) return;
    const lastCol = columnsWrapper.lastElementChild as HTMLElement | null;
    if (!lastCol) return;
    columnsWrapper.scrollLeft = Math.max(
      0,
      lastCol.offsetLeft + lastCol.offsetWidth - columnsWrapper.clientWidth,
    );
  };

  const render = (): void => {
    renderTarget.replaceChildren(buildColumns());

    for (const ta of renderTarget.querySelectorAll<HTMLTextAreaElement>('textarea[data-nav-input]')) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
    focusPending();
    if (activeDocNodeId !== null) scrollColumnsToEnd();
  };

  const startPolling = (fetchUrl: string, itemsPath?: string): void => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (saveTimer !== null) return;
      void fetch(fetchUrl)
        .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
        .then((data) => {
          if (saveTimer !== null || data === null) return;
          const raw = itemsPath
            ? getByPath(data, itemsPath)
            : (data as Record<string, unknown>).nodes ?? data;
          if (!Array.isArray(raw)) return;
          if (JSON.stringify(raw) === JSON.stringify(nodes)) return;
          nodes = raw as TreeNode[];
          render();
        })
        .catch(() => undefined);
    }, 3000);
  };

  if (component.source) {
    const treeMatch = component.source.url.match(/^\/api\/trees\/(.+)$/);
    if (treeMatch) resolvedTreeId = decodeURIComponent(treeMatch[1]);
    const fetchUrl = resolvedTreeId && !component.source.itemsPath
      ? `/api/trees/${encodeURIComponent(resolvedTreeId)}?include_docs=true`
      : component.source.url;
    void fetch(fetchUrl)
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : Promise.resolve({ nodes: [] })))
      .then((data) => {
        const raw = component.source!.itemsPath
          ? getByPath(data, component.source!.itemsPath)
          : (data as Record<string, unknown>).nodes ?? data;
        nodes = Array.isArray(raw) ? (raw as TreeNode[]) : [];
        const docs = (data as Record<string, unknown>).docs;
        if (docs && typeof docs === 'object' && !Array.isArray(docs)) {
          for (const [nodeId, content] of Object.entries(docs as Record<string, unknown>)) {
            if (typeof content === 'string') docContentCache.set(nodeId, content);
          }
        }
        render();
      })
      .catch(() => render());
  } else {
    render();
  }
  return outer;
};
