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
  applyCssProps(outer, component as unknown as Record<string, unknown>);

  let focusedNodeId: string | null = null;

  const stateMap = new Map<string, ItemState>();

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

      const bullet = document.createElement('span');
      bullet.textContent = node.children?.length ? '▸' : '•';
      bullet.style.userSelect = 'none';
      bullet.style.color = 'rgba(0,0,0,0.35)';
      bullet.style.flexShrink = '0';
      bullet.style.width = '10px';
      bullet.style.fontSize = '10px';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = node.text;
      input.dataset.nodeId = node.id;
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

      input.addEventListener('keydown', (e: KeyboardEvent) => {
        const itemState = stateMap.get(itemValue);
        if (!itemState) return;

        if (e.key === 'Enter') {
          e.preventDefault();
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

        if (e.key === 'Backspace' && input.value === '') {
          e.preventDefault();
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

        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const allIds = flatIds(topLevelNodes);
          const idx = allIds.indexOf(node.id);
          const prevId = idx > 0 ? allIds[idx - 1] : null;
          if (prevId) {
            outer.querySelector<HTMLInputElement>(`[data-node-id="${CSS.escape(prevId)}"]`)?.focus();
          }
          return;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const allIds = flatIds(topLevelNodes);
          const idx = allIds.indexOf(node.id);
          const nextId = idx < allIds.length - 1 ? allIds[idx + 1] : null;
          if (nextId) {
            outer.querySelector<HTMLInputElement>(`[data-node-id="${CSS.escape(nextId)}"]`)?.focus();
          }
          return;
        }
      });

      row.appendChild(bullet);
      row.appendChild(input);
      li.appendChild(row);

      if (node.children?.length) {
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
      stateMap.set(leaf.value, { nodes: [], expanded: false, saveTimer: null });
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
  applyCssProps(outer, component as unknown as Record<string, unknown>);

  let nodes: TreeNode[] = cloneNodes(component.data.nodes);
  let pendingFocusId: string | null = null;
  let focusedNodeId: string | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

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
      bullet.textContent = node.children?.length ? '▸' : '•';
      bullet.style.userSelect = 'none';
      bullet.style.color = 'rgba(0,0,0,0.35)';
      bullet.style.flexShrink = '0';
      bullet.style.width = '10px';
      bullet.style.fontSize = '10px';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = node.text;
      input.dataset.nodeId = node.id;
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

      input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
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

        if (e.key === 'Backspace' && input.value === '') {
          e.preventDefault();
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

        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const allIds = flatIds(nodes);
          const idx = allIds.indexOf(node.id);
          const prevId = idx > 0 ? allIds[idx - 1] : null;
          if (prevId) {
            outer.querySelector<HTMLInputElement>(`[data-node-id="${CSS.escape(prevId)}"]`)?.focus();
          }
          return;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const allIds = flatIds(nodes);
          const idx = allIds.indexOf(node.id);
          const nextId = idx < allIds.length - 1 ? allIds[idx + 1] : null;
          if (nextId) {
            outer.querySelector<HTMLInputElement>(`[data-node-id="${CSS.escape(nextId)}"]`)?.focus();
          }
          return;
        }
      });

      row.appendChild(bullet);
      row.appendChild(input);
      li.appendChild(row);

      if (node.children?.length) {
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
