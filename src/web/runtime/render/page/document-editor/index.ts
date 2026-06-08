import type { DocumentEditorComponent } from '../../../../schema/component/kind/document-editor';
import type { TreeNode } from '../../../../schema/component/kind/tree-editor';
import { applyCssProps, cloneNodes, getByPath, randomId } from './ops';
import { buildUl } from './list';
import type { DocumentEditorState, DocumentEditorContext } from './types';
import { theme } from '../theme';

export const renderDocumentEditor = (
  id: string,
  component: DocumentEditorComponent,
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
  outer.style.background = theme.bg;
  outer.style.color = theme.textHigh;
  applyCssProps(outer, component as unknown as Record<string, unknown>);

  const state: DocumentEditorState = {
    nodes: cloneNodes(component.data.nodes),
    pendingFocusId: null,
    pendingFocusCursorPos: null,
    focusedNodeId: null,
    saveTimer: null,
    anchorIdx: null,
    activeIdx: null,
    resolvedTreeId: treeId,
    clipboard: null,
    history: [],
    collapsedIds: new Set(),
  };

  let renderTarget: HTMLElement = outer;

  let ctx!: DocumentEditorContext;

  const scheduleSave = (): void => {
    if (!state.resolvedTreeId) return;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      state.saveTimer = null;
      void fetch(`/api/trees/${encodeURIComponent(state.resolvedTreeId!)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: state.nodes }),
      });
    }, 500);
  };

  const pushHistory = (): void => {
    state.history.push(cloneNodes(state.nodes));
    if (state.history.length > 50) state.history.shift();
  };

  const focusPending = (): void => {
    if (!state.pendingFocusId) return;
    const fid = state.pendingFocusId;
    const pos = state.pendingFocusCursorPos;
    state.pendingFocusId = null;
    state.pendingFocusCursorPos = null;
    const el = outer.querySelector<HTMLTextAreaElement>(`[data-node-id="${CSS.escape(fid)}"]`);
    if (el) {
      el.focus();
      if (pos !== null) el.setSelectionRange(pos, pos);
    }
  };

  const render = (): void => {
    if (state.nodes.length === 0) {
      const hint = document.createElement('div');
      Object.assign(hint.style, {
        color: theme.textDim,
        fontSize: '12px',
        padding: '4px 0',
        cursor: 'pointer',
        userSelect: 'none',
      });
      hint.textContent = '+ 追加 (クリック or Enter)';
      hint.addEventListener('click', () => {
        const newNode: TreeNode = { id: randomId(), text: '' };
        state.nodes.push(newNode);
        state.pendingFocusId = newNode.id;
        scheduleSave();
        render();
      });
      hint.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') hint.click();
      });
      renderTarget.replaceChildren(hint);
      return;
    }

    const ul = buildUl(state.nodes, 0, ctx);
    renderTarget.replaceChildren(ul);
    for (const ta of renderTarget.querySelectorAll<HTMLTextAreaElement>('textarea[data-nav-input]')) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
    focusPending();
  };

  ctx = {
    id,
    outer,
    sourceComponentId: component.sourceComponentId,
    state,
    scheduleSave,
    pushHistory,
    render,
  };

  if (component.sourceComponentId) {
    outer.dataset.sourceComponentId = component.sourceComponentId;
    outer.style.display = 'flex';
    outer.style.flexDirection = 'column';
    Object.assign(outer.style, {
      background: theme.bg,
      borderLeft: `1px solid ${theme.borderMid}`,
      zIndex: '10',
    });

    const headerEl = document.createElement('div');
    Object.assign(headerEl.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: '11px',
      color: theme.textLow,
      padding: '4px 8px',
      userSelect: 'none',
      flexShrink: '0',
      borderBottom: `1px solid ${theme.borderFaint}`,
      gap: '4px',
    });
    const titleEl = document.createElement('span');
    titleEl.textContent = '—';
    Object.assign(titleEl.style, {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      flex: '1',
    });
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    Object.assign(closeBtn.style, {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: theme.textDim,
      fontSize: '15px',
      padding: '0 2px',
      lineHeight: '1',
      flexShrink: '0',
    });
    headerEl.appendChild(titleEl);
    headerEl.appendChild(closeBtn);
    outer.appendChild(headerEl);

    const innerContainer = document.createElement('div');
    Object.assign(innerContainer.style, {
      flex: '1',
      minHeight: '0',
      overflow: 'auto',
      padding: '8px 12px',
      boxSizing: 'border-box',
    });
    outer.appendChild(innerContainer);
    renderTarget = innerContainer;

    const closePanel = (): void => {
      outer.style.display = 'none';
      state.nodes = [];
      while (state.history.length) state.history.pop();
      document.dispatchEvent(new CustomEvent('document-editor:closed', {
        detail: { sourceFrameId: component.sourceComponentId },
      }));
    };
    closeBtn.addEventListener('click', closePanel);

    const listenFrameId = component.sourceComponentId;
  }

  if (component.source) {
    const treeMatch = component.source.url.match(/^\/api\/trees\/(.+)$/);
    if (treeMatch) state.resolvedTreeId = decodeURIComponent(treeMatch[1]);
    void fetch(component.source.url)
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : Promise.resolve({ nodes: [] })))
      .then((data) => {
        const raw = component.source!.itemsPath
          ? getByPath(data, component.source!.itemsPath)
          : (data as Record<string, unknown>).nodes ?? data;
        state.nodes = Array.isArray(raw) ? (raw as TreeNode[]) : [];
        render();
      })
      .catch(() => render());
  } else {
    render();
  }

  return outer;
};
