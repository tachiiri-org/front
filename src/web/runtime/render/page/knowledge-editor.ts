import type { KnowledgeEditorComponent } from '../../../schema/component/kind/knowledge-editor';
import type { TreeNode } from '../../../schema/component/kind/tree-editor';
import { ALL_CSS_PROP_KEYS } from '../../../schema/component';

type NodeFocusDetail = { knowledgeEditorFrameId: string; nodeId: string; nodeText: string };

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
  let anchorIdx: number | null = null;
  let activeIdx: number | null = null;
  let mousedownNodeId: string | null = null;
  let pendingSelectionStart: number | null = null;
  let resolvedTreeId = treeId;
  let docNodeId: string | null = null;
  let renderTarget: HTMLElement = outer;
  let clipboard: TreeNode[] | null = null;
  const history: TreeNode[][] = [];

  if (component.sourceComponentId) {
    const header = document.createElement('div');
    Object.assign(header.style, {
      fontSize: '11px',
      color: 'rgba(0,0,0,0.4)',
      padding: '0 0 4px 0',
      userSelect: 'none',
      flexShrink: '0',
    });
    header.textContent = '—';
    outer.appendChild(header);

    const contentEl = document.createElement('div');
    contentEl.style.flex = '1';
    contentEl.style.overflow = 'auto';
    outer.appendChild(contentEl);
    renderTarget = contentEl;

    document.addEventListener('knowledge-editor:node-focus', (e: Event) => {
      const detail = (e as CustomEvent<NodeFocusDetail>).detail;
      if (detail.knowledgeEditorFrameId !== component.sourceComponentId) return;
      docNodeId = detail.nodeId;
      header.textContent = detail.nodeText || '(no title)';
      nodes = [];
      render();
      void fetch(`/api/docs/${encodeURIComponent(detail.nodeId)}`)
        .then((res) => (res.ok ? (res.json() as Promise<unknown>) : Promise.resolve(null)))
        .then((data) => {
          if (docNodeId !== detail.nodeId) return;
          const raw = (data as Record<string, unknown> | null)?.nodes;
          nodes = Array.isArray(raw) ? (raw as TreeNode[]) : [];
          render();
        })
        .catch(() => render());
    });
  }

  const scheduleSave = (): void => {
    const saveUrl = docNodeId !== null
      ? `/api/docs/${encodeURIComponent(docNodeId)}`
      : resolvedTreeId
      ? `/api/trees/${encodeURIComponent(resolvedTreeId)}`
      : null;
    if (!saveUrl) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void fetch(saveUrl, {
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

  const buildColumn = (list: TreeNode[], fullPath: string[], columnIndex: number): HTMLElement => {
    const col = document.createElement('div');
    col.style.width = 'max-content';
    col.style.maxWidth = '40vw';
    col.style.minWidth = '180px';
    col.style.borderRight = '1px solid rgba(0,0,0,0.2)';
    col.style.overflowY = 'auto';
    col.style.overflowX = 'hidden';
    col.style.flexShrink = '0';
    col.style.boxSizing = 'border-box';
    col.style.padding = '4px 0';

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

      const input = document.createElement('textarea');
      input.value = node.text;
      input.rows = 1;
      input.dataset.nodeId = node.id;
      input.dataset.navInput = 'node';
      input.dataset.columnIndex = String(columnIndex);
      Object.assign(input.style, {
        display: 'block',
        width: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        background: isIssue ? 'rgba(255, 160, 0, 0.07)' : isProposed ? 'rgba(0, 160, 80, 0.07)' : 'transparent',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: 'inherit',
        padding: '2px 4px',
        color: isIssue ? 'rgba(160, 80, 0, 0.85)' : isProposed ? 'rgba(0, 100, 50, 0.85)' : 'inherit',
        fontStyle: isProposed ? 'italic' : 'normal',
        borderRadius: isIssue || isProposed ? '3px' : '0',
        boxSizing: 'border-box',
      });
      (input.style as unknown as Record<string, string>)['field-sizing'] = 'content';

      input.addEventListener('focus', () => {
        if (focusedNodeId !== node.id) {
          const fromMouse = mousedownNodeId === node.id;
          mousedownNodeId = null;
          focusedNodeId = node.id;
          dispatchNodeFocus(id, node.id, node.text);
          pendingFocusId = node.id;
          if (fromMouse) pendingSelectionStart = input.selectionStart;
          render();
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
        if (e.key === 'Enter' && e.ctrlKey && isProposed) {
          e.preventDefault();
          pushHistory();
          const loc = findNode(nodes, node.id);
          if (loc) {
            const n = loc.parent[loc.index];
            n.status = 'accepted';
            delete n.proposedAt;
            delete n.proposedBy;
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
          pushHistory();
          anchorIdx = null; activeIdx = null;
          const cursor = input.selectionStart ?? input.value.length;
          const tail = input.value.slice(cursor);
          const newNode: TreeNode = { id: randomId(), text: tail };
          const loc = findNode(nodes, node.id);
          if (loc) {
            loc.parent[loc.index].text = input.value.slice(0, cursor);
            loc.parent.splice(loc.index + 1, 0, newNode);
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
          const loc = findNode(nodes, node.id);
          if (loc) loc.parent.splice(loc.index, 1);
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
          const loc = findNode(nodes, node.id);
          if (loc) loc.parent.splice(loc.index, 1);
          focusedNodeId = prevId;
          pendingFocusId = prevId;
          scheduleSave();
          render();
          return;
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
                const snode = sloc.parent[sloc.index];
                const prev = sloc.parent[sloc.index - 1];
                sloc.parent.splice(sloc.index, 1);
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
            const loc = findNode(nodes, node.id);
            if (loc && loc.index > 0) {
              const prev = loc.parent[loc.index - 1];
              loc.parent.splice(loc.index, 1);
              if (!prev.children) prev.children = [];
              prev.children.push(node);
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
            if (allLoc) {
              const loc = findNode(nodes, node.id);
              if (loc) loc.parent.splice(loc.index, 1);
              allLoc.parent.splice(allLoc.index + 1, 0, node);
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
            const loc = findNode(nodes, node.id);
            if (loc && loc.index > 0) {
              pushHistory();
              const tmp = loc.parent[loc.index - 1];
              loc.parent[loc.index - 1] = loc.parent[loc.index];
              loc.parent[loc.index] = tmp;
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
            const loc = findNode(nodes, node.id);
            if (loc && loc.index < loc.parent.length - 1) {
              pushHistory();
              const tmp = loc.parent[loc.index + 1];
              loc.parent[loc.index + 1] = loc.parent[loc.index];
              loc.parent[loc.index] = tmp;
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
          if (e.key === 'x' && clipboard.length > 0) {
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
          const loc = findNode(nodes, node.id);
          if (loc) {
            loc.parent.splice(loc.index + 1, 0, ...pasted);
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
          if (node.children?.length) {
            pendingFocusId = node.children[0].id;
            render();
          }
          return;
        }

        if (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) {
          e.preventDefault();
          if (anchorIdx !== null) { anchorIdx = null; activeIdx = null; updateNodeSelectionVisuals(outer, [], null, null); }
          const ancestors = getAncestors(node.id, nodes);
          if (ancestors && ancestors.length > 0) {
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

      const marker = document.createElement('span');
      Object.assign(marker.style, {
        width: '6px',
        height: '6px',
        flexShrink: '0',
        alignSelf: 'center',
        borderRadius: '1px',
        background: desc.issue
          ? 'rgba(255, 160, 0, 0.65)'
          : desc.proposed
          ? 'rgba(0, 160, 80, 0.65)'
          : !isIssue && !isProposed
          ? 'rgba(0, 0, 0, 0.15)'
          : 'transparent',
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

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flex = '1';
    wrapper.style.minHeight = '0';
    wrapper.style.overflowX = 'auto';

    wrapper.appendChild(buildColumn(nodes, fullPath, 0));

    for (let i = 0; i < fullPath.length; i++) {
      const loc = findNode(nodes, fullPath[i]);
      if (!loc) break;
      const selected = loc.parent[loc.index];
      if (selected.children?.length) {
        wrapper.appendChild(buildColumn(selected.children, fullPath, i + 1));
      }
    }

    return wrapper;
  };

  const render = (): void => {
    if (nodes.length === 0) {
      const hint = document.createElement('div');
      Object.assign(hint.style, {
        color: 'rgba(0,0,0,0.3)',
        fontSize: '12px',
        padding: '8px 12px',
        cursor: 'pointer',
        userSelect: 'none',
      });
      hint.textContent = '+ 追加 (クリック or Enter)';
      hint.addEventListener('click', () => {
        const newNode: TreeNode = { id: randomId(), text: '' };
        nodes.push(newNode);
        pendingFocusId = newNode.id;
        scheduleSave();
        render();
      });
      hint.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') hint.click();
      });
      renderTarget.replaceChildren(hint);
      return;
    }

    renderTarget.replaceChildren(buildColumns());
    for (const ta of renderTarget.querySelectorAll<HTMLTextAreaElement>('textarea[data-node-id]')) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
    focusPending();
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
    void fetch(component.source.url)
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : Promise.resolve({ nodes: [] })))
      .then((data) => {
        const raw = component.source!.itemsPath
          ? getByPath(data, component.source!.itemsPath)
          : (data as Record<string, unknown>).nodes ?? data;
        nodes = Array.isArray(raw) ? (raw as TreeNode[]) : [];
        render();
      })
      .catch(() => render());
  } else {
    render();
  }
  return outer;
};
