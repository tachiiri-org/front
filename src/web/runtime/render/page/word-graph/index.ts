import type { WordGraphComponent } from '../../../../schema/component/kind/word-graph';
import { applyCssProps, cloneData } from './ops';
import { buildColumns } from './columns';
import type { WordGraphState, WordGraphContext } from './types';
import { theme } from '../theme';

export const renderWordGraph = (
  id: string,
  component: WordGraphComponent,
  graphId?: string,
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

  const cloned = cloneData(component.data.texts, component.data.words);
  const state: WordGraphState = {
    texts: cloned.texts,
    words: cloned.words,
    path: [],
    pendingFocusId: null,
    pendingFocusColumn: null,
    focusedId: null,
    focusedColumn: null,
    saveTimer: null,
    history: [],
    inputCache: new Map(),
  };

  let resolvedGraphId = graphId;
  if (!resolvedGraphId && component.source) {
    const m = component.source.url.match(/^\/api\/word-graphs\/(.+)$/);
    if (m) resolvedGraphId = decodeURIComponent(m[1]);
  }

  let ctx!: WordGraphContext;

  const scheduleSave = (): void => {
    if (!resolvedGraphId) return;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      state.saveTimer = null;
      void fetch(`/api/word-graphs/${encodeURIComponent(resolvedGraphId!)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: state.texts, words: state.words }),
      });
    }, 500);
  };

  const pushHistory = (): void => {
    state.history.push(cloneData(state.texts, state.words));
    if (state.history.length > 50) state.history.shift();
  };

  const scrollToEnd = (): void => {
    const wrapper = outer.querySelector<HTMLElement>('[data-columns-wrapper]');
    if (!wrapper) return;
    const spacer = outer.querySelector<HTMLElement>('[data-columns-spacer]');
    if (spacer) spacer.style.width = `${wrapper.clientWidth}px`;
    let lastCol = wrapper.lastElementChild as HTMLElement | null;
    if (lastCol?.dataset.columnsSpacer) lastCol = lastCol.previousElementSibling as HTMLElement | null;
    if (lastCol) {
      wrapper.scrollLeft = Math.max(0, lastCol.offsetLeft + lastCol.offsetWidth - wrapper.clientWidth);
    }
  };

  const focusPending = (): void => {
    if (!state.pendingFocusId) return;
    const fid = state.pendingFocusId;
    const fcol = state.pendingFocusColumn;
    state.pendingFocusId = null;
    state.pendingFocusColumn = null;
    const selector =
      fcol !== null
        ? `[data-node-id="${CSS.escape(fid)}"][data-column-index="${fcol}"]`
        : `[data-node-id="${CSS.escape(fid)}"]`;
    const el = outer.querySelector<HTMLTextAreaElement>(selector);
    if (!el) return;
    el.focus({ preventScroll: true });
  };

  const render = (): void => {
    outer.replaceChildren(buildColumns(ctx));
    for (const ta of outer.querySelectorAll<HTMLTextAreaElement>('textarea[data-nav-input]')) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
    focusPending();
    scrollToEnd();
    requestAnimationFrame(scrollToEnd);
  };

  const scheduleRender = (): void => {
    requestAnimationFrame(() => render());
  };

  ctx = { id, outer, state, scheduleSave, pushHistory, render, scheduleRender };

  if (component.source) {
    void fetch(component.source.url)
      .then((res) =>
        res.ok ? (res.json() as Promise<unknown>) : Promise.resolve({ texts: [], words: [] }),
      )
      .then((data) => {
        const d = data as Record<string, unknown>;
        state.texts = Array.isArray(d.texts) ? (d.texts as typeof state.texts) : [];
        state.words = Array.isArray(d.words) ? (d.words as typeof state.words) : [];
        render();
      })
      .catch(() => render());
  } else {
    render();
  }

  return outer;
};
