import type { TreeNode } from './ops';
import type { DefinitionEditorContext } from './types';
import { findNode, dispatchNodeFocus, dispatchNodeTextChange } from './ops';
import { createKeydownHandler } from './keyboard';
import { theme } from '../theme';

const createInput = (node: TreeNode, ctx: DefinitionEditorContext): HTMLTextAreaElement => {
  const { state } = ctx;

  const input = document.createElement('textarea');
  input.rows = 1;
  input.value = node.text;
  input.dataset.nodeId = node.id;
  input.dataset.navInput = 'node';
  Object.assign(input.style, {
    flex: '1',
    border: 'none',
    outline: 'none',
    resize: 'none',
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    background: 'transparent',
    color: 'inherit',
    borderRadius: '0',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    padding: '2px 4px',
    boxSizing: 'border-box',
  });
  (input.style as unknown as Record<string, string>)['field-sizing'] = 'content';

  input.addEventListener('focus', () => {
    if (state.focusedNodeId !== node.id) {
      state.focusedNodeId = node.id;
      dispatchNodeFocus(ctx.id, node.id, node.text);
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

  input.addEventListener('mousedown', () => {
    if (state.anchorIdx === null) return;
    state.anchorIdx = null;
    state.activeIdx = null;
    ctx.outer.querySelectorAll<HTMLTextAreaElement>('[data-node-id]').forEach(inp => { inp.style.background = 'transparent'; });
  });

  input.addEventListener('keydown', createKeydownHandler(node, input, ctx));

  return input;
};

export const buildUl = (list: TreeNode[], depth: number, ctx: DefinitionEditorContext): HTMLUListElement => {
  const { state } = ctx;
  const ul = document.createElement('ul');
  ul.style.listStyle = 'none';
  ul.style.padding = depth === 0 ? '0' : '0 0 0 20px';
  ul.style.margin = '0';

  for (const node of list) {
    const li = document.createElement('li');

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'flex-start';
    row.style.gap = '6px';

    const bullet = document.createElement('span');
    bullet.textContent = !node.children?.length ? '•' : state.collapsedIds.has(node.id) ? '▸' : '▾';
    bullet.style.userSelect = 'none';
    bullet.style.color = theme.textDim;
    bullet.style.flexShrink = '0';
    bullet.style.width = '10px';
    bullet.style.fontSize = '10px';
    bullet.style.marginTop = '4px';
    if (node.children?.length) {
      bullet.style.cursor = 'pointer';
      bullet.addEventListener('click', () => {
        if (state.collapsedIds.has(node.id)) {
          state.collapsedIds.delete(node.id);
        } else {
          state.collapsedIds.add(node.id);
        }
        state.pendingFocusId = node.id;
        ctx.render();
      });
    }

    const input = createInput(node, ctx);
    row.appendChild(bullet);
    row.appendChild(input);
    li.appendChild(row);

    if (node.children?.length && !state.collapsedIds.has(node.id)) {
      li.appendChild(buildUl(node.children, depth + 1, ctx));
    }

    ul.appendChild(li);
  }

  return ul;
};
