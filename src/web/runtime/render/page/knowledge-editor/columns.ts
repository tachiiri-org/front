import type { TreeNode } from '../../../../schema/component/kind/tree-editor';
import type { KnowledgeEditorContext } from './types';
import { randomId, findNode, flatIds, getAncestors, hasDescendants } from './ops';
import { createInput } from './input';

export const buildColumn = (
  list: TreeNode[],
  fullPath: string[],
  columnIndex: number,
  onAdd: (text: string) => void,
  ctx: KnowledgeEditorContext,
  selectedIdSet: Set<string> = new Set(),
): HTMLElement => {
  const { state } = ctx;
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
      ctx.pushHistory();
      onAdd(text);
      draftInput.value = '';
      draftInput.style.height = 'auto';
      return;
    }
    if (e.key === 'ArrowDown') {
      const onLastLine = !(draftInput.value.slice(draftInput.selectionStart ?? draftInput.value.length).includes('\n'));
      if (!onLastLine) return;
      e.preventDefault();
      const colInputs = Array.from(ctx.outer.querySelectorAll<HTMLTextAreaElement>(`[data-nav-input][data-column-index="${columnIndex}"]`))
        .filter(inp => inp.offsetParent !== null);
      const pos = colInputs.indexOf(draftInput);
      if (pos < colInputs.length - 1) colInputs[pos + 1].focus({ preventScroll: true });
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
    const isMultiSelected = selectedIdSet.has(node.id);
    row.dataset.inPath = isSelectedInPath ? 'true' : 'false';
    row.style.display = 'flex';
    row.style.alignItems = 'flex-start';
    row.style.gap = '4px';
    row.style.padding = '1px 8px 1px 12px';
    row.style.background = isMultiSelected
      ? 'rgba(0, 120, 255, 0.12)'
      : isSelectedInPath
      ? 'rgba(0, 120, 255, 0.08)'
      : 'transparent';

    let input = state.inputCache.get(node.id);
    if (!input) {
      input = createInput(node, ctx);
      state.inputCache.set(node.id, input);
    }
    if (input.value !== node.text) input.value = node.text;
    input.dataset.columnIndex = String(columnIndex);
    input.style.background = isIssue ? 'rgba(255, 160, 0, 0.07)' : isProposed ? 'rgba(0, 160, 80, 0.07)' : 'transparent';
    input.style.color = isIssue ? 'rgba(160, 80, 0, 0.85)' : isProposed ? 'rgba(0, 100, 50, 0.85)' : 'inherit';
    input.style.fontStyle = isProposed ? 'italic' : 'normal';
    input.style.borderRadius = isIssue || isProposed ? '3px' : '0';

    const marker = document.createElement('span');
    const isDocOpen = state.activeDocNodeId === node.id;
    const docStatus = state.docContentCache.get(node.id) ?? '';
    const hasDoc = docStatus !== '';
    const baseColor = isDocOpen
      ? 'rgba(0, 120, 255, 0.7)'
      : docStatus === 'issue'
      ? 'rgba(255, 160, 0, 0.65)'
      : docStatus === 'proposed'
      ? 'rgba(0, 160, 80, 0.65)'
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
      if (state.activeDocNodeId === node.id) {
        state.activeDocNodeId = null;
        document.dispatchEvent(new CustomEvent('knowledge-editor:doc-toggle', {
          detail: { knowledgeEditorFrameId: ctx.id, nodeId: null, nodeText: null },
        }));
      } else {
        state.activeDocNodeId = node.id;
        if (!state.docContentCache.has(node.id)) ctx.fetchDocContent(node.id);
        document.dispatchEvent(new CustomEvent('knowledge-editor:doc-toggle', {
          detail: { knowledgeEditorFrameId: ctx.id, nodeId: node.id, nodeText: node.text },
        }));
      }
      ctx.render();
      ctx.syncOuterWidth();
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

export const buildColumns = (ctx: KnowledgeEditorContext): HTMLElement => {
  const { state } = ctx;
  const fullPath: string[] = state.focusedNodeId
    ? [...(getAncestors(state.focusedNodeId, state.nodes) ?? []), state.focusedNodeId]
    : [];

  const allIds = flatIds(state.nodes);
  const lo = state.anchorIdx !== null && state.activeIdx !== null ? Math.min(state.anchorIdx, state.activeIdx) : -1;
  const hi = state.anchorIdx !== null && state.activeIdx !== null ? Math.max(state.anchorIdx, state.activeIdx) : -1;
  const selectedIdSet = lo >= 0 ? new Set(allIds.slice(lo, hi + 1)) : new Set<string>();

  const colEls: HTMLElement[] = [];

  const wrapper = document.createElement('div');
  wrapper.dataset.columnsWrapper = 'true';
  wrapper.style.display = 'flex';
  wrapper.style.flex = '1';
  wrapper.style.minHeight = '0';
  wrapper.style.overflowX = 'auto';
  wrapper.style.position = 'relative';

  const rootCol = buildColumn(state.nodes, fullPath, 0, (text) => {
    const newNode: TreeNode = { id: randomId(), text };
    state.nodes.unshift(newNode);
    state.pendingFocusId = newNode.id;
    ctx.scheduleSave();
    ctx.render();
  }, ctx, selectedIdSet);
  colEls.push(rootCol);
  wrapper.appendChild(rootCol);

  for (let i = 0; i < fullPath.length; i++) {
    const loc = findNode(state.nodes, fullPath[i]);
    if (!loc) break;
    const selected = loc.parent[loc.index];
    const isLastInPath = i === fullPath.length - 1;
    if (selected.children?.length || isLastInPath) {
      const col = buildColumn(selected.children ?? [], fullPath, i + 1, (text) => {
        const newNode: TreeNode = { id: randomId(), text };
        if (!selected.children) selected.children = [];
        selected.children.unshift(newNode);
        state.pendingFocusId = newNode.id;
        ctx.scheduleSave();
        ctx.render();
      }, ctx, selectedIdSet);
      colEls.push(col);
      wrapper.appendChild(col);
    }
  }

  const spacer = document.createElement('div');
  spacer.dataset.columnsSpacer = 'true';
  spacer.style.flexShrink = '0';
  spacer.style.width = '0';
  wrapper.appendChild(spacer);

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
      if (!col) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const colRect = col.getBoundingClientRect();
      const targetScrollLeft = wrapper.scrollLeft + (colRect.left - wrapperRect.left);
      wrapper.scrollTo({ left: Math.max(0, targetScrollLeft), behavior: 'smooth' });
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
    const loc = findNode(state.nodes, fullPath[i]);
    if (!loc) break;
    const sep = document.createElement('span');
    sep.textContent = '›';
    sep.style.color = 'rgba(0,0,0,0.25)';
    sep.style.flexShrink = '0';
    breadcrumb.appendChild(sep);
    breadcrumb.appendChild(makeBreadcrumbItem(loc.parent[loc.index].text, i, i === fullPath.length - 1));
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
