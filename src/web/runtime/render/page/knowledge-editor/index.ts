import type { KnowledgeEditorComponent } from '../../../../schema/component/kind/knowledge-editor';
import type { TreeNode } from '../../../../schema/component/kind/tree-editor';
import { applyCssProps, cloneNodes, getByPath, findNode, flatIds, reassignIds } from './ops';
import { buildColumns } from './columns';
import type { KnowledgeEditorState, KnowledgeEditorContext } from './types';

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

  const state: KnowledgeEditorState = {
    nodes: cloneNodes(component.data.nodes),
    pendingFocusId: null,
    focusedNodeId: null,
    saveTimer: null,
    pollTimer: null,
    rafId: null,
    anchorIdx: null,
    activeIdx: null,
    mousedownNodeId: null,
    pendingSelectionStart: null,
    resolvedTreeId: treeId,
    clipboard: null,
    history: [],
    inputCache: new Map(),
    activeDocNodeId: null,
    docContentCache: new Map(),
  };

  let ctx!: KnowledgeEditorContext;

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

  const scrollColumnsToEnd = (): void => {
    const columnsWrapper = outer.querySelector<HTMLElement>('[data-columns-wrapper]');
    if (!columnsWrapper) return;
    let lastCol = columnsWrapper.lastElementChild as HTMLElement | null;
    if (lastCol?.dataset.columnsSpacer) lastCol = lastCol.previousElementSibling as HTMLElement | null;
    if (!lastCol) return;
    columnsWrapper.scrollLeft = Math.max(
      0,
      lastCol.offsetLeft + lastCol.offsetWidth - columnsWrapper.clientWidth,
    );
  };

  const syncOuterWidth = (): void => {
    if (state.activeDocNodeId !== null) {
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

  const focusPending = (): void => {
    if (!state.pendingFocusId) return;
    const fid = state.pendingFocusId;
    state.pendingFocusId = null;
    const el = outer.querySelector<HTMLTextAreaElement>(`[data-node-id="${CSS.escape(fid)}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (state.pendingSelectionStart !== null) {
      el.setSelectionRange(state.pendingSelectionStart, state.pendingSelectionStart);
      state.pendingSelectionStart = null;
    }
  };

  const render = (): void => {
    outer.replaceChildren(buildColumns(ctx));
    for (const ta of outer.querySelectorAll<HTMLTextAreaElement>('textarea[data-nav-input]')) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
    focusPending();
    scrollColumnsToEnd();
    requestAnimationFrame(() => {
      const wrapperEl = outer.querySelector<HTMLElement>('[data-columns-wrapper]');
      const spacerEl = outer.querySelector<HTMLElement>('[data-columns-spacer]');
      if (wrapperEl && spacerEl) spacerEl.style.width = `${wrapperEl.clientWidth}px`;
      scrollColumnsToEnd();
    });
  };

  const scheduleRender = (): void => {
    if (state.rafId !== null) return;
    state.rafId = requestAnimationFrame(() => {
      state.rafId = null;
      render();
    });
  };

  const getDocStatus = (nodes: TreeNode[]): string => {
    let hasProposed = false;
    for (const node of nodes) {
      if (node.type === 'issue' || node.text?.startsWith('?')) return 'issue';
      if (node.status === 'proposed') hasProposed = true;
      if (node.children?.length) {
        const childStatus = getDocStatus(node.children);
        if (childStatus === 'issue') return 'issue';
        if (childStatus === 'proposed') hasProposed = true;
      }
    }
    return hasProposed ? 'proposed' : '1';
  };

  const fetchDocContent = (nodeId: string): void => {
    void fetch(`/api/trees/${encodeURIComponent(nodeId)}`)
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
      .then((data) => {
        const nodes = (data as Record<string, unknown> | null)?.nodes;
        state.docContentCache.set(nodeId, Array.isArray(nodes) && nodes.length > 0 ? getDocStatus(nodes as TreeNode[]) : '');
        render();
      })
      .catch(() => {
        state.docContentCache.set(nodeId, '');
        render();
      });
  };

  ctx = { id, outer, state, scheduleSave, pushHistory, render, scheduleRender, fetchDocContent, syncOuterWidth };

  document.addEventListener('document-editor:closed', (e: Event) => {
    const detail = (e as CustomEvent<{ sourceFrameId: string }>).detail;
    if (detail.sourceFrameId !== id) return;
    const prevActiveId = state.activeDocNodeId;
    state.activeDocNodeId = null;
    render();
    syncOuterWidth();
    if (prevActiveId) fetchDocContent(prevActiveId);
  });

  document.addEventListener('document-editor:move-to-knowledge', (e: Event) => {
    const detail = (e as CustomEvent<{ sourceFrameId: string; nodes: TreeNode[] }>).detail;
    if (detail.sourceFrameId !== id) return;
    pushHistory();
    const newNodes = reassignIds(detail.nodes);
    const loc = state.focusedNodeId ? findNode(state.nodes, state.focusedNodeId) : null;
    if (loc) {
      loc.parent.splice(loc.index + 1, 0, ...newNodes);
    } else {
      state.nodes.push(...newNodes);
    }
    state.anchorIdx = null; state.activeIdx = null;
    state.pendingFocusId = newNodes[0].id;
    scheduleSave();
    render();
  });

  const startPolling = (fetchUrl: string, itemsPath?: string): void => {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
      if (state.saveTimer !== null) return;
      void fetch(fetchUrl)
        .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
        .then((data) => {
          if (state.saveTimer !== null || data === null) return;
          const raw = itemsPath
            ? getByPath(data, itemsPath)
            : (data as Record<string, unknown>).nodes ?? data;
          if (!Array.isArray(raw)) return;
          if (JSON.stringify(raw) === JSON.stringify(state.nodes)) return;
          state.nodes = raw as TreeNode[];
          render();
        })
        .catch(() => undefined);
    }, 3000);
  };

  if (component.source) {
    const treeMatch = component.source.url.match(/^\/api\/trees\/(.+)$/);
    if (treeMatch) state.resolvedTreeId = decodeURIComponent(treeMatch[1]);
    const fetchUrl = state.resolvedTreeId && !component.source.itemsPath
      ? `/api/trees/${encodeURIComponent(state.resolvedTreeId)}?include_docs=true`
      : component.source.url;
    void fetch(fetchUrl)
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : Promise.resolve({ nodes: [] })))
      .then((data) => {
        const raw = component.source!.itemsPath
          ? getByPath(data, component.source!.itemsPath)
          : (data as Record<string, unknown>).nodes ?? data;
        state.nodes = Array.isArray(raw) ? (raw as TreeNode[]) : [];
        const docs = (data as Record<string, unknown>).docs;
        if (docs && typeof docs === 'object' && !Array.isArray(docs)) {
          for (const [nodeId, content] of Object.entries(docs as Record<string, unknown>)) {
            if (typeof content === 'string') state.docContentCache.set(nodeId, content);
          }
        }
        render();
      })
      .catch(() => render());
  } else {
    render();
  }

  void startPolling;
  return outer;
};
