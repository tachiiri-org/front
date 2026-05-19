import type { TreeEditorComponent, TreeNode } from '../../../schema/component/kind/tree-editor';
import { ALL_CSS_PROP_KEYS } from '../../../schema/component';

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

export const renderEditableTree = (
  id: string,
  component: TreeEditorComponent,
  treeId?: string,
): HTMLElement => {
  const wrapper = document.createElement('div');
  wrapper.dataset.frameId = id;
  wrapper.style.overflow = 'auto';
  wrapper.style.boxSizing = 'border-box';
  wrapper.style.padding = '8px 12px';
  wrapper.style.fontFamily = 'monospace';
  wrapper.style.fontSize = '13px';
  applyCssProps(wrapper, component as unknown as Record<string, unknown>);

  let nodes: TreeNode[] = cloneNodes(component.data.nodes);
  let pendingFocusId: string | null = null;

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
    const el = wrapper.querySelector<HTMLInputElement>(`[data-node-id="${CSS.escape(fid)}"]`);
    el?.focus();
  };

  const buildUl = (list: TreeNode[], depth: number): HTMLUListElement => {
    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = depth === 0 ? '0' : '0 0 0 20px';
    ul.style.margin = '0';

    for (const node of list) {
      const li = document.createElement('li');
      li.style.margin = '1px 0';

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
        padding: '1px 0',
        color: 'inherit',
      });

      input.addEventListener('input', () => {
        const loc = findNode(nodes, node.id);
        if (loc) {
          loc.parent[loc.index].text = input.value;
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
          // dedent: move node up one level as sibling of parent
          // find parent of parent to insert after
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
            wrapper.querySelector<HTMLInputElement>(`[data-node-id="${CSS.escape(prevId)}"]`)?.focus();
          }
          return;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const allIds = flatIds(nodes);
          const idx = allIds.indexOf(node.id);
          const nextId = idx < allIds.length - 1 ? allIds[idx + 1] : null;
          if (nextId) {
            wrapper.querySelector<HTMLInputElement>(`[data-node-id="${CSS.escape(nextId)}"]`)?.focus();
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
      wrapper.replaceChildren(hint);
      return;
    }

    const ul = buildUl(nodes, 0);
    wrapper.replaceChildren(ul);
    focusPending();
  };

  render();
  return wrapper;
};
