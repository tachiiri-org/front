import type { OutlinerComponent } from '../../../schema/component/kind/outliner';
import type { TreeNode } from '../../../schema/component/kind/tree-editor';
import { ALL_CSS_PROP_KEYS } from '../../../schema/component';

type NodeFocusDetail = { outlinerFrameId: string; nodeId: string; nodeText: string };

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

const dispatchNodeFocus = (outlinerFrameId: string, nodeId: string, nodeText: string): void => {
  document.dispatchEvent(new CustomEvent('outliner:node-focus', {
    detail: { outlinerFrameId, nodeId, nodeText },
  }));
};

const dispatchNodeTextChange = (outlinerFrameId: string, nodeId: string, nodeText: string): void => {
  document.dispatchEvent(new CustomEvent('outliner:node-text-change', {
    detail: { outlinerFrameId, nodeId, nodeText },
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
  const inputs = container.querySelectorAll<HTMLInputElement>('[data-node-id]');
  for (const input of inputs) {
    const idx = allIds.indexOf(input.dataset.nodeId ?? '');
    input.style.background = lo >= 0 && idx >= lo && idx <= hi ? 'rgba(0, 120, 255, 0.12)' : 'transparent';
  }
};

export const renderOutliner = (
  id: string,
  component: OutlinerComponent,
  treeId?: string,
): HTMLElement => {
  const outer = document.createElement('div');
  outer.dataset.frameId = id;
  outer.style.overflow = 'auto';
  outer.style.boxSizing = 'border-box';
  outer.style.padding = '8px 12px';
  outer.style.fontSize = '13px';
  outer.style.lineHeight = '1.5';
  applyCssProps(outer, component as unknown as Record<string, unknown>);

  let nodes: TreeNode[] = cloneNodes(component.data.nodes);
  let pendingFocusId: string | null = null;
  let focusedNodeId: string | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let anchorIdx: number | null = null;
  let activeIdx: number | null = null;
  const collapsedIds = new Set<string>();
  let resolvedTreeId = treeId;
  let docNodeId: string | null = null;
  let renderTarget: HTMLElement = outer;

  if (component.sourceComponentId) {
    outer.style.overflow = 'hidden';
    outer.style.display = 'flex';
    outer.style.flexDirection = 'column';

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

    document.addEventListener('outliner:node-focus', (e: Event) => {
      const detail = (e as CustomEvent<NodeFocusDetail>).detail;
      if (detail.outlinerFrameId !== component.sourceComponentId) return;
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
      void fetch(saveUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes }),
      });
    }, 500);
  };

  const focusPending = (): void => {
    if (!pendingFocusId) return;
    const fid = pendingFocusId;
    pendingFocusId = null;
    const el = outer.querySelector<HTMLInputElement>(`[data-node-id="${CSS.escape(fid)}"]`);
    el?.focus();
  };

  const buildUl = (list: TreeNode[], depth: number): HTMLUListElement => {
    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = depth === 0 ? '0' : '0 0 0 20px';
    ul.style.margin = '0';

    for (const node of list) {
      const li = document.createElement('li');

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';

      const isProposed = node.status === 'proposed';

      const bullet = document.createElement('span');
      bullet.textContent = !node.children?.length ? '•' : collapsedIds.has(node.id) ? '▸' : '▾';
      bullet.style.userSelect = 'none';
      bullet.style.color = isProposed ? 'rgba(200, 120, 0, 0.7)' : 'rgba(0,0,0,0.35)';
      bullet.style.flexShrink = '0';
      bullet.style.width = '10px';
      bullet.style.fontSize = '10px';
      if (node.children?.length) {
        bullet.style.cursor = 'pointer';
        bullet.addEventListener('click', () => {
          if (collapsedIds.has(node.id)) {
            collapsedIds.delete(node.id);
          } else {
            collapsedIds.add(node.id);
          }
          pendingFocusId = node.id;
          render();
        });
      }

      const input = document.createElement('input');
      input.type = 'text';
      input.value = node.text;
      input.dataset.nodeId = node.id;
      input.dataset.navInput = 'node';
      Object.assign(input.style, {
        flex: '1',
        border: 'none',
        outline: 'none',
        background: isProposed ? 'rgba(255, 160, 0, 0.07)' : 'transparent',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: 'inherit',
        padding: '2px 4px',
        color: isProposed ? 'rgba(160, 80, 0, 0.85)' : 'inherit',
        fontStyle: isProposed ? 'italic' : 'normal',
        borderRadius: isProposed ? '3px' : '0',
      });

      input.addEventListener('focus', () => {
        if (focusedNodeId !== node.id) {
          focusedNodeId = node.id;
          dispatchNodeFocus(id, node.id, node.text);
        }
      });

      input.addEventListener('input', () => {
        const loc = findNode(nodes, node.id);
        if (loc) {
          loc.parent[loc.index].text = input.value;
          if (focusedNodeId === node.id) dispatchNodeTextChange(id, node.id, input.value);
          scheduleSave();
        }
      });

      input.addEventListener('mousedown', () => {
        if (anchorIdx === null) return;
        anchorIdx = null;
        activeIdx = null;
        outer.querySelectorAll<HTMLInputElement>('[data-node-id]').forEach(inp => { inp.style.background = 'transparent'; });
      });

      input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && e.ctrlKey && isProposed) {
          e.preventDefault();
          const loc = findNode(nodes, node.id);
          if (loc) {
            const n = loc.parent[loc.index];
            n.status = 'accepted';
            delete n.proposedAt;
            delete n.proposedBy;
          }
          pendingFocusId = node.id;
          scheduleSave();
          render();
          return;
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          anchorIdx = null; activeIdx = null;
          const newNode: TreeNode = { id: randomId(), text: '' };
          const loc = findNode(nodes, node.id);
          if (loc) {
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
          anchorIdx = null; activeIdx = null;
          const allIds = flatIds(nodes);
          const idx = allIds.indexOf(node.id);
          const prevId = idx > 0 ? allIds[idx - 1] : null;
          const loc = findNode(nodes, node.id);
          if (loc) loc.parent.splice(loc.index, 1);
          pendingFocusId = prevId;
          scheduleSave();
          render();
          return;
        }

        if (e.key === 'Backspace' && input.value === '') {
          e.preventDefault();
          anchorIdx = null; activeIdx = null;
          const allIds = flatIds(nodes);
          const idx = allIds.indexOf(node.id);
          const prevId = idx > 0 ? allIds[idx - 1] : null;
          const loc = findNode(nodes, node.id);
          if (loc) loc.parent.splice(loc.index, 1);
          pendingFocusId = prevId;
          scheduleSave();
          render();
          return;
        }

        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
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

        if (e.key === 'ArrowDown' && e.ctrlKey) {
          e.preventDefault();
          if (node.children?.length && collapsedIds.has(node.id)) {
            collapsedIds.delete(node.id);
            pendingFocusId = node.id;
            render();
          }
          return;
        }

        if (e.key === 'ArrowUp' && e.ctrlKey) {
          e.preventDefault();
          if (node.children?.length && !collapsedIds.has(node.id)) {
            collapsedIds.add(node.id);
            pendingFocusId = node.id;
            render();
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
          const newActiveIdx = Math.max(0, (activeIdx ?? idx) - 1);
          activeIdx = newActiveIdx;
          updateNodeSelectionVisuals(outer, allIds, anchorIdx, activeIdx);
          outer.querySelector<HTMLInputElement>(`[data-node-id="${CSS.escape(allIds[newActiveIdx])}"]`)?.focus();
          return;
        }

        if (e.key === 'ArrowDown' && e.shiftKey) {
          e.preventDefault();
          const allIds = flatIds(nodes);
          const idx = allIds.indexOf(node.id);
          if (idx < 0) return;
          if (anchorIdx === null) anchorIdx = idx;
          const newActiveIdx = Math.min(allIds.length - 1, (activeIdx ?? idx) + 1);
          activeIdx = newActiveIdx;
          updateNodeSelectionVisuals(outer, allIds, anchorIdx, activeIdx);
          outer.querySelector<HTMLInputElement>(`[data-node-id="${CSS.escape(allIds[newActiveIdx])}"]`)?.focus();
          return;
        }

        if (e.key === 'ArrowRight' && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
          e.preventDefault();
          if (anchorIdx !== null) {
            anchorIdx = null; activeIdx = null;
            updateNodeSelectionVisuals(outer, [], null, null);
          }
          const navInputs = Array.from(outer.querySelectorAll<HTMLInputElement>('[data-nav-input]'))
            .filter(inp => inp.offsetParent !== null);
          const idx = navInputs.indexOf(input);
          if (idx < navInputs.length - 1) navInputs[idx + 1].focus();
          return;
        }

        if (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) {
          e.preventDefault();
          if (anchorIdx !== null) {
            anchorIdx = null; activeIdx = null;
            updateNodeSelectionVisuals(outer, [], null, null);
          }
          const navInputs = Array.from(outer.querySelectorAll<HTMLInputElement>('[data-nav-input]'))
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
          e.preventDefault();
          if (anchorIdx !== null) {
            anchorIdx = null; activeIdx = null;
            updateNodeSelectionVisuals(outer, [], null, null);
          }
          const navInputs = Array.from(outer.querySelectorAll<HTMLInputElement>('[data-nav-input]'))
            .filter(inp => inp.offsetParent !== null);
          const idx = navInputs.indexOf(input);
          if (idx > 0) navInputs[idx - 1].focus();
          return;
        }

        if (e.key === 'ArrowDown' && !e.ctrlKey) {
          e.preventDefault();
          if (anchorIdx !== null) {
            anchorIdx = null; activeIdx = null;
            updateNodeSelectionVisuals(outer, [], null, null);
          }
          const navInputs = Array.from(outer.querySelectorAll<HTMLInputElement>('[data-nav-input]'))
            .filter(inp => inp.offsetParent !== null);
          const idx = navInputs.indexOf(input);
          if (idx < navInputs.length - 1) navInputs[idx + 1].focus();
          return;
        }
      });

      row.appendChild(bullet);
      row.appendChild(input);
      li.appendChild(row);

      if (node.children?.length && !collapsedIds.has(node.id)) {
        li.appendChild(buildUl(node.children, depth + 1));
      }

      ul.appendChild(li);
    }

    return ul;
  };

  const render = (): void => {
    if (nodes.length === 0) {
      const hint = document.createElement('div');
      Object.assign(hint.style, {
        color: 'rgba(0,0,0,0.3)',
        fontSize: '12px',
        padding: '4px 0',
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

    const ul = buildUl(nodes, 0);
    renderTarget.replaceChildren(ul);
    focusPending();
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
