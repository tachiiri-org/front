import type { WordGraphComponent } from '../../../../schema/component/kind/word-graph';
import { applyCssProps, cloneData } from './ops';
import { buildColumns } from './columns';
import type { WordGraphState, WordGraphContext } from './types';
import { theme } from '../theme';

const supportsFieldSizing = CSS.supports('field-sizing', 'content');

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
    pendingFocusCursorPos: null,
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
      void fetch(`/api/graph/${encodeURIComponent(resolvedGraphId!)}`, {
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
    const cursorPos = state.pendingFocusCursorPos;
    state.pendingFocusId = null;
    state.pendingFocusColumn = null;
    state.pendingFocusCursorPos = null;
    const selector =
      fcol !== null
        ? `[data-node-id="${CSS.escape(fid)}"][data-column-index="${fcol}"]`
        : `[data-node-id="${CSS.escape(fid)}"]`;
    const el = outer.querySelector<HTMLTextAreaElement>(selector);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (cursorPos !== null) {
      el.selectionStart = cursorPos;
      el.selectionEnd = cursorPos;
    }
  };

  const render = (): void => {
    const scrollTops = new Map<number, number>();
    outer.querySelectorAll<HTMLElement>('[data-col-index]').forEach(col => {
      scrollTops.set(parseInt(col.dataset.colIndex ?? '0', 10), col.scrollTop);
    });

    outer.replaceChildren(buildColumns(ctx));

    if (!supportsFieldSizing) {
      const tas = Array.from(outer.querySelectorAll<HTMLTextAreaElement>('textarea[data-nav-input]'));
      for (const ta of tas) ta.style.height = 'auto';
      const heights = tas.map(ta => ta.scrollHeight);
      for (let i = 0; i < tas.length; i++) tas[i].style.height = `${heights[i]}px`;
    }

    outer.querySelectorAll<HTMLElement>('[data-col-index]').forEach(col => {
      const saved = scrollTops.get(parseInt(col.dataset.colIndex ?? '0', 10));
      if (saved !== undefined) col.scrollTop = saved;
    });

    focusPending();
    scrollToEnd();
    requestAnimationFrame(scrollToEnd);
  };

  const scheduleRender = (): void => {
    requestAnimationFrame(() => render());
  };

  ctx = { id, outer, state, scheduleSave, pushHistory, render, scheduleRender };

  if (resolvedGraphId) {
    const base = `/api/graph/${encodeURIComponent(resolvedGraphId)}`;
    void Promise.all([
      fetch(`${base}/words`).then((r) => r.ok ? r.json() as Promise<unknown> : { words: [] }),
      fetch(`${base}/texts`).then((r) => r.ok ? r.json() as Promise<unknown> : { texts: [] }),
    ])
      .then(([wordsData, textsData]) => {
        const wd = wordsData as Record<string, unknown>;
        const td = textsData as Record<string, unknown>;
        state.words = Array.isArray(wd.words) ? (wd.words as typeof state.words) : [];
        state.texts = Array.isArray(td.texts) ? (td.texts as typeof state.texts) : [];
        render();
      })
      .catch(() => render());
  } else {
    render();
  }

  return outer;
};
