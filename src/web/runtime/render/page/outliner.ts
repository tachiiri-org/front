import type { OutlinerComponent } from '../../../schema/component/kind/outliner';
import type { TreeNode } from '../../../schema/component/kind/tree-editor';
import { ALL_CSS_PROP_KEYS } from '../../../schema/component';

type SourceItem = {
  value: string;
  label: string;
  children?: SourceItem[];
};

type ItemState = {
  nodes: TreeNode[];
  expanded: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null;
  anchorIdx: number | null;
  activeIdx: number | null;
  collapsedIds: Set<string>;
};

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

const renderSourceDrivenOutliner = (
  id: string,
  component: OutlinerComponent,
): HTMLElement => {
  const source = component.source!;
  const outer = document.createElement('div');
  outer.dataset.frameId = id;
  outer.style.overflow = 'auto';
  outer.style.boxSizing = 'border-box';
  outer.style.padding = '8px 12px';
  outer.style.fontSize = '13px';
  outer.style.lineHeight = '1.5';
  applyCssProps(outer, component as unknown as Record<string, unknown>);

  let focusedNodeId: string | null = null;

  const stateMap = new Map<string, ItemState>();

  const getAllNavInputs = (): HTMLInputElement[] =>
    Array.from(outer.querySelectorAll<HTMLInputElement>('[data-nav-input]'))
      .filter(inp => inp.offsetParent !== null);

  const buildNodeUl = (
    list: TreeNode[],
    topLevelNodes: TreeNode[],
    depth: number,
    itemValue: string,
  ): HTMLUListElement => {
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

      const isCollapsed = !!(node.children?.length && stateMap.get(itemValue)?.collapsedIds.has(node.id));
      const bullet = document.createElement('span');
      bullet.textContent = !node.children?.length ? '•' : isCollapsed ? '▸' : '▾';
      bullet.style.userSelect = 'none';
      bullet.style.color = 'rgba(0,0,0,0.35)';
      bullet.style.flexShrink = '0';
      bullet.style.width = '10px';
      bullet.style.fontSize = '10px';
      if (node.children?.length) {
        bullet.style.cursor = 'pointer';
        bullet.addEventListener('click', () => {
          const itemState = stateMap.get(itemValue);
          if (!itemState) return;
          if (itemState.collapsedIds.has(node.id)) {
            itemState.collapsedIds.delete(node.id);
          } else {
            itemState.collapsedIds.add(node.id);
          }
          renderItemNodes(itemValue, itemState, node.id);
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
        background: 'transparent',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: 'inherit',
        padding: '2px 0',
        color: 'inherit',
      });

      input.addEventListener('focus', () => {
        if (focusedNodeId !== node.id) {
          focusedNodeId = node.id;
          dispatchNodeFocus(id, node.id, node.text);
        }
      });

      input.addEventListener('input', () => {
        const itemState = stateMap.get(itemValue);
        if (!itemState) return;
        const loc = findNode(topLevelNodes, node.id);
        if (loc) {
          loc.parent[loc.index].text = input.value;
          if (focusedNodeId === node.id) dispatchNodeTextChange(id, node.id, input.value);
          scheduleItemSave(itemValue, itemState);
        }
      });

      input.addEventListener('mousedown', () => {
        const itemState = stateMap.get(itemValue);
        if (!itemState || itemState.anchorIdx === null) return;
        itemState.anchorIdx = null;
        itemState.activeIdx = null;
        const c = outer.querySelector<HTMLElement>(`[data-item-container="${CSS.escape(itemValue)}"]`);
        if (c) updateNodeSelectionVisuals(c, [], null, null);
      });

      input.addEventListener('keydown', (e: KeyboardEvent) => {
        const itemState = stateMap.get(itemValue);
        if (!itemState) return;

        if (e.key === 'Enter') {
          e.preventDefault();
          itemState.anchorIdx = null; itemState.activeIdx = null;
          const newNode: TreeNode = { id: randomId(), text: '' };
          const loc = findNode(topLevelNodes, node.id);
          if (loc) {
            loc.parent.splice(loc.index + 1, 0, newNode);
          } else {
            topLevelNodes.push(newNode);
          }
          scheduleItemSave(itemValue, itemState);
          renderItemNodes(itemValue, itemState, newNode.id);
          return;
        }

        if (e.key === 'Backspace' && e.ctrlKey && e.shiftKey) {
          e.preventDefault();
          itemState.anchorIdx = null; itemState.activeIdx = null;
          const allIds = flatIds(topLevelNodes);
          const idx = allIds.indexOf(node.id);
          const prevId = idx > 0 ? allIds[idx - 1] : null;
          const loc = findNode(topLevelNodes, node.id);
          if (loc) loc.parent.splice(loc.index, 1);
          scheduleItemSave(itemValue, itemState);
          renderItemNodes(itemValue, itemState, prevId);
          return;
        }

        if (e.key === 'Backspace' && input.value === '') {
          e.preventDefault();
          itemState.anchorIdx = null; itemState.activeIdx = null;
          const allIds = flatIds(topLevelNodes);
          const idx = allIds.indexOf(node.id);
          const prevId = idx > 0 ? allIds[idx - 1] : null;
          const loc = findNode(topLevelNodes, node.id);
          if (loc) loc.parent.splice(loc.index, 1);
          scheduleItemSave(itemValue, itemState);
          renderItemNodes(itemValue, itemState, prevId);
          return;
        }

        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          itemState.anchorIdx = null; itemState.activeIdx = null;
          const loc = findNode(topLevelNodes, node.id);
          if (loc && loc.index > 0) {
            const prev = loc.parent[loc.index - 1];
            loc.parent.splice(loc.index, 1);
            if (!prev.children) prev.children = [];
            prev.children.push(node);
            scheduleItemSave(itemValue, itemState);
            renderItemNodes(itemValue, itemState, node.id);
          }
          return;
        }

        if (e.key === 'Tab' && e.shiftKey) {
          e.preventDefault();
          itemState.anchorIdx = null; itemState.activeIdx = null;
          const allLoc = findDedentTarget(topLevelNodes, node.id);
          if (allLoc) {
            const loc = findNode(topLevelNodes, node.id);
            if (loc) loc.parent.splice(loc.index, 1);
            allLoc.parent.splice(allLoc.index + 1, 0, node);
            scheduleItemSave(itemValue, itemState);
            renderItemNodes(itemValue, itemState, node.id);
          }
          return;
        }

        if (e.key === 'ArrowDown' && e.ctrlKey) {
          e.preventDefault();
          if (node.children?.length && itemState.collapsedIds.has(node.id)) {
            itemState.collapsedIds.delete(node.id);
            renderItemNodes(itemValue, itemState, node.id);
          }
          return;
        }

        if (e.key === 'ArrowUp' && e.ctrlKey) {
          e.preventDefault();
          if (node.children?.length && !itemState.collapsedIds.has(node.id)) {
            itemState.collapsedIds.add(node.id);
            renderItemNodes(itemValue, itemState, node.id);
          }
          return;
        }

        if (e.key === 'ArrowUp' && e.shiftKey && e.altKey) {
          e.preventDefault();
          if (itemState.anchorIdx !== null && itemState.activeIdx !== null) {
            const allIds = flatIds(topLevelNodes);
            const lo = Math.min(itemState.anchorIdx, itemState.activeIdx);
            const hi = Math.max(itemState.anchorIdx, itemState.activeIdx);
            const selIds = allIds.slice(lo, hi + 1);
            const firstLoc = findNode(topLevelNodes, selIds[0]);
            if (firstLoc && firstLoc.index > 0 && selIds.every((sid, i) => firstLoc.parent[firstLoc.index + i]?.id === sid)) {
              const block = firstLoc.parent.splice(firstLoc.index, selIds.length);
              firstLoc.parent.splice(firstLoc.index - 1, 0, ...block);
              scheduleItemSave(itemValue, itemState);
              renderItemNodes(itemValue, itemState, selIds[0]);
              const newAllIds = flatIds(topLevelNodes);
              const newLo = newAllIds.indexOf(selIds[0]);
              const newHi = newAllIds.indexOf(selIds[selIds.length - 1]);
              const wasAsc = itemState.anchorIdx <= itemState.activeIdx;
              itemState.anchorIdx = wasAsc ? newLo : newHi;
              itemState.activeIdx = wasAsc ? newHi : newLo;
              const c = outer.querySelector<HTMLElement>(`[data-item-container="${CSS.escape(itemValue)}"]`);
              if (c) updateNodeSelectionVisuals(c, newAllIds, itemState.anchorIdx, itemState.activeIdx);
            }
          } else {
            itemState.anchorIdx = null; itemState.activeIdx = null;
            const loc = findNode(topLevelNodes, node.id);
            if (loc && loc.index > 0) {
              const tmp = loc.parent[loc.index - 1];
              loc.parent[loc.index - 1] = loc.parent[loc.index];
              loc.parent[loc.index] = tmp;
              scheduleItemSave(itemValue, itemState);
              renderItemNodes(itemValue, itemState, node.id);
            }
          }
          return;
        }

        if (e.key === 'ArrowDown' && e.shiftKey && e.altKey) {
          e.preventDefault();
          if (itemState.anchorIdx !== null && itemState.activeIdx !== null) {
            const allIds = flatIds(topLevelNodes);
            const lo = Math.min(itemState.anchorIdx, itemState.activeIdx);
            const hi = Math.max(itemState.anchorIdx, itemState.activeIdx);
            const selIds = allIds.slice(lo, hi + 1);
            const firstLoc = findNode(topLevelNodes, selIds[0]);
            if (firstLoc && firstLoc.index + selIds.length < firstLoc.parent.length && selIds.every((sid, i) => firstLoc.parent[firstLoc.index + i]?.id === sid)) {
              const block = firstLoc.parent.splice(firstLoc.index, selIds.length);
              firstLoc.parent.splice(firstLoc.index + 1, 0, ...block);
              scheduleItemSave(itemValue, itemState);
              renderItemNodes(itemValue, itemState, selIds[0]);
              const newAllIds = flatIds(topLevelNodes);
              const newLo = newAllIds.indexOf(selIds[0]);
              const newHi = newAllIds.indexOf(selIds[selIds.length - 1]);
              const wasAsc = itemState.anchorIdx <= itemState.activeIdx;
              itemState.anchorIdx = wasAsc ? newLo : newHi;
              itemState.activeIdx = wasAsc ? newHi : newLo;
              const c = outer.querySelector<HTMLElement>(`[data-item-container="${CSS.escape(itemValue)}"]`);
              if (c) updateNodeSelectionVisuals(c, newAllIds, itemState.anchorIdx, itemState.activeIdx);
            }
          } else {
            itemState.anchorIdx = null; itemState.activeIdx = null;
            const loc = findNode(topLevelNodes, node.id);
            if (loc && loc.index < loc.parent.length - 1) {
              const tmp = loc.parent[loc.index + 1];
              loc.parent[loc.index + 1] = loc.parent[loc.index];
              loc.parent[loc.index] = tmp;
              scheduleItemSave(itemValue, itemState);
              renderItemNodes(itemValue, itemState, node.id);
            }
          }
          return;
        }

        if (e.key === 'ArrowUp' && e.shiftKey) {
          e.preventDefault();
          const allIds = flatIds(topLevelNodes);
          const idx = allIds.indexOf(node.id);
          if (idx < 0) return;
          if (itemState.anchorIdx === null) itemState.anchorIdx = idx;
          const newActiveIdx = Math.max(0, (itemState.activeIdx ?? idx) - 1);
          itemState.activeIdx = newActiveIdx;
          const c = outer.querySelector<HTMLElement>(`[data-item-container="${CSS.escape(itemValue)}"]`);
          if (c) updateNodeSelectionVisuals(c, allIds, itemState.anchorIdx, itemState.activeIdx);
          const targetId = allIds[newActiveIdx];
          outer.querySelector<HTMLInputElement>(`[data-node-id="${CSS.escape(targetId)}"]`)?.focus();
          return;
        }

        if (e.key === 'ArrowDown' && e.shiftKey) {
          e.preventDefault();
          const allIds = flatIds(topLevelNodes);
          const idx = allIds.indexOf(node.id);
          if (idx < 0) return;
          if (itemState.anchorIdx === null) itemState.anchorIdx = idx;
          const newActiveIdx = Math.min(allIds.length - 1, (itemState.activeIdx ?? idx) + 1);
          itemState.activeIdx = newActiveIdx;
          const c = outer.querySelector<HTMLElement>(`[data-item-container="${CSS.escape(itemValue)}"]`);
          if (c) updateNodeSelectionVisuals(c, allIds, itemState.anchorIdx, itemState.activeIdx);
          const targetId = allIds[newActiveIdx];
          outer.querySelector<HTMLInputElement>(`[data-node-id="${CSS.escape(targetId)}"]`)?.focus();
          return;
        }

        if (e.key === 'ArrowUp' && !e.ctrlKey) {
          e.preventDefault();
          if (itemState.anchorIdx !== null) {
            itemState.anchorIdx = null; itemState.activeIdx = null;
            const c = outer.querySelector<HTMLElement>(`[data-item-container="${CSS.escape(itemValue)}"]`);
            if (c) updateNodeSelectionVisuals(c, [], null, null);
          }
          const navInputs = getAllNavInputs();
          const idx = navInputs.indexOf(input);
          if (idx > 0) navInputs[idx - 1].focus();
          return;
        }

        if (e.key === 'ArrowDown' && !e.ctrlKey) {
          e.preventDefault();
          if (itemState.anchorIdx !== null) {
            itemState.anchorIdx = null; itemState.activeIdx = null;
            const c = outer.querySelector<HTMLElement>(`[data-item-container="${CSS.escape(itemValue)}"]`);
            if (c) updateNodeSelectionVisuals(c, [], null, null);
          }
          const navInputs = getAllNavInputs();
          const idx = navInputs.indexOf(input);
          if (idx < navInputs.length - 1) navInputs[idx + 1].focus();
          return;
        }
      });

      row.appendChild(bullet);
      row.appendChild(input);
      li.appendChild(row);

      if (node.children?.length && !stateMap.get(itemValue)?.collapsedIds.has(node.id)) {
        li.appendChild(buildNodeUl(node.children, topLevelNodes, depth + 1, itemValue));
      }

      ul.appendChild(li);
    }

    return ul;
  };

  const scheduleItemSave = (itemValue: string, itemState: ItemState): void => {
    if (itemState.saveTimer) clearTimeout(itemState.saveTimer);
    itemState.saveTimer = setTimeout(() => {
      void fetch(`/api/trees/${encodeURIComponent(itemValue)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: itemState.nodes }),
      });
    }, 500);
  };

  const renderItemNodes = (itemValue: string, itemState: ItemState, pendingFocusId: string | null): void => {
    const container = outer.querySelector<HTMLElement>(`[data-item-container="${CSS.escape(itemValue)}"]`);
    if (!container) return;

    if (itemState.nodes.length === 0) {
      const hint = document.createElement('div');
      Object.assign(hint.style, {
        color: 'rgba(0,0,0,0.3)',
        fontSize: '12px',
        padding: '2px 0',
        cursor: 'pointer',
        userSelect: 'none',
      });
      hint.textContent = '+ 追加 (クリック or Enter)';
      hint.addEventListener('click', () => {
        const newNode: TreeNode = { id: randomId(), text: '' };
        itemState.nodes.push(newNode);
        scheduleItemSave(itemValue, itemState);
        renderItemNodes(itemValue, itemState, newNode.id);
      });
      container.replaceChildren(hint);
      return;
    }

    const ul = buildNodeUl(itemState.nodes, itemState.nodes, 0, itemValue);
    container.replaceChildren(ul);
    if (pendingFocusId) {
      const el = container.querySelector<HTMLInputElement>(`[data-node-id="${CSS.escape(pendingFocusId)}"]`);
      el?.focus();
    }
  };

  const toggleLeafItem = (itemValue: string, itemContainer: HTMLElement): void => {
    const itemState = stateMap.get(itemValue);
    if (!itemState) return;

    if (!itemState.expanded) {
      const doExpand = (nodes: TreeNode[]): void => {
        itemState.nodes = nodes;
        itemState.expanded = true;
        itemContainer.style.display = 'block';
        renderItemNodes(itemValue, itemState, null);
      };

      void fetch(`/api/trees/${encodeURIComponent(itemValue)}`)
        .then((res) => (res.ok ? res.json() : { nodes: [] }))
        .then((data) => {
          const loaded = (data as Record<string, unknown>).nodes;
          doExpand(Array.isArray(loaded) ? (loaded as TreeNode[]) : []);
        })
        .catch(() => {
          doExpand([]);
        });
    } else {
      itemState.expanded = false;
      itemContainer.style.display = 'none';
    }
  };

  const buildLeafItem = (leaf: SourceItem): HTMLLIElement => {
    const li = document.createElement('li');

    if (!stateMap.has(leaf.value)) {
      stateMap.set(leaf.value, { nodes: [], expanded: false, saveTimer: null, anchorIdx: null, activeIdx: null, collapsedIds: new Set() });
    }

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '6px';

    const arrow = document.createElement('span');
    arrow.textContent = '▸';
    Object.assign(arrow.style, {
      fontSize: '10px',
      color: 'rgba(0,0,0,0.35)',
      width: '10px',
      flexShrink: '0',
      cursor: 'pointer',
      userSelect: 'none',
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.value = leaf.label;
    input.dataset.navInput = 'leaf';
    Object.assign(input.style, {
      flex: '1',
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
      padding: '2px 0',
      color: 'inherit',
    });

    input.addEventListener('focus', () => {
      if (focusedNodeId !== leaf.value) {
        focusedNodeId = leaf.value;
        dispatchNodeFocus(id, leaf.value, leaf.label);
      }
    });

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' && e.ctrlKey) {
        e.preventDefault();
        const itemState = stateMap.get(leaf.value);
        if (itemState && !itemState.expanded) {
          arrow.textContent = '▾';
          toggleLeafItem(leaf.value, itemContainer);
        }
        return;
      }
      if (e.key === 'ArrowUp' && e.ctrlKey) {
        e.preventDefault();
        const itemState = stateMap.get(leaf.value);
        if (itemState && itemState.expanded) {
          arrow.textContent = '▸';
          toggleLeafItem(leaf.value, itemContainer);
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const navInputs = getAllNavInputs();
        const idx = navInputs.indexOf(input);
        if (idx > 0) navInputs[idx - 1].focus();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const navInputs = getAllNavInputs();
        const idx = navInputs.indexOf(input);
        if (idx < navInputs.length - 1) navInputs[idx + 1].focus();
        return;
      }
    });

    let renameTimer: ReturnType<typeof setTimeout> | null = null;
    input.addEventListener('input', () => {
      if (focusedNodeId === leaf.value) dispatchNodeTextChange(id, leaf.value, input.value);
      if (renameTimer) clearTimeout(renameTimer);
      const newLabel = input.value.trim();
      if (!newLabel) return;
      renameTimer = setTimeout(() => {
        const namePart = leaf.value.startsWith('list/') ? leaf.value.slice('list/'.length) : leaf.value;
        void fetch(`/api/list/${encodeURIComponent(namePart)}/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: newLabel }),
        });
      }, 500);
    });

    const itemContainer = document.createElement('div');
    itemContainer.dataset.itemContainer = leaf.value;
    itemContainer.style.display = 'none';
    itemContainer.style.paddingLeft = '16px';

    arrow.addEventListener('click', () => {
      const itemState = stateMap.get(leaf.value);
      if (itemState) {
        arrow.textContent = itemState.expanded ? '▸' : '▾';
      }
      toggleLeafItem(leaf.value, itemContainer);
    });

    row.appendChild(arrow);
    row.appendChild(input);
    li.appendChild(row);
    li.appendChild(itemContainer);
    return li;
  };

  const renderItems = (items: SourceItem[]): void => {
    outer.replaceChildren();
    const rootUl = document.createElement('ul');
    rootUl.style.listStyle = 'none';
    rootUl.style.padding = '0';
    rootUl.style.margin = '0';

    for (const item of items) {
      const li = document.createElement('li');
      li.style.marginBottom = '4px';

      if (item.children) {
        const header = document.createElement('div');
        Object.assign(header.style, {
          fontSize: '11px',
          fontWeight: 'bold',
          color: 'rgba(0,0,0,0.5)',
          paddingLeft: '4px',
          paddingTop: '8px',
          paddingBottom: '2px',
          userSelect: 'none',
          cursor: 'pointer',
        });
        const catArrow = document.createElement('span');
        catArrow.textContent = '▾';
        catArrow.style.fontSize = '9px';
        catArrow.style.marginRight = '4px';
        const catLabel = document.createElement('span');
        catLabel.textContent = item.label.toUpperCase();
        header.appendChild(catArrow);
        header.appendChild(catLabel);

        const childrenContainer = document.createElement('div');
        let categoryExpanded = true;

        header.addEventListener('click', () => {
          categoryExpanded = !categoryExpanded;
          catArrow.textContent = categoryExpanded ? '▾' : '▸';
          childrenContainer.style.display = categoryExpanded ? 'block' : 'none';
        });

        li.appendChild(header);

        const childUl = document.createElement('ul');
        childUl.style.listStyle = 'none';
        childUl.style.padding = '0';
        childUl.style.margin = '0';

        for (const child of item.children) {
          const childLi = buildLeafItem(child);
          childUl.appendChild(childLi);
        }

        childrenContainer.appendChild(childUl);
        li.appendChild(childrenContainer);
      } else {
        const childLi = buildLeafItem(item);
        li.replaceChildren(childLi);
      }

      rootUl.appendChild(li);
    }

    outer.appendChild(rootUl);
  };

  void fetch(source.url)
    .then((res) => (res.ok ? res.json() : { items: [] }))
    .then((data) => {
      const raw = source.itemsPath ? getByPath(data, source.itemsPath) : data;
      const items = Array.isArray(raw) ? (raw as SourceItem[]) : [];
      renderItems(items);
    })
    .catch(() => {
      outer.textContent = 'Failed to load items';
    });

  return outer;
};

export const renderOutliner = (
  id: string,
  component: OutlinerComponent,
  treeId?: string,
): HTMLElement => {
  if (component.source) {
    return renderSourceDrivenOutliner(id, component);
  }

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

  const scheduleSave = (): void => {
    if (!treeId) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void fetch(`/api/trees/${encodeURIComponent(treeId)}`, {
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

      const bullet = document.createElement('span');
      bullet.textContent = !node.children?.length ? '•' : collapsedIds.has(node.id) ? '▸' : '▾';
      bullet.style.userSelect = 'none';
      bullet.style.color = 'rgba(0,0,0,0.35)';
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
        background: 'transparent',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: 'inherit',
        padding: '2px 0',
        color: 'inherit',
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
          return;
        }

        if (e.key === 'Tab' && e.shiftKey) {
          e.preventDefault();
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
      outer.replaceChildren(hint);
      return;
    }

    const ul = buildUl(nodes, 0);
    outer.replaceChildren(ul);
    focusPending();
  };

  render();
  return outer;
};
