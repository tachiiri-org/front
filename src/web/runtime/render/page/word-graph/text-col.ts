import type { WordGraphTextColComponent } from '../../../../schema/component/kind/word-graph-col';
import { applyCssProps, cloneData, migrateGraphData, getLangText, hasPrimaryLang, setLangText } from './ops';
import { getOrCreateGraphState } from './store';
import type { ColContext } from './types';
import { findWord, randomId, findText } from './ops';
import { createInput } from './input';
import { theme } from '../theme';

const supportsFieldSizing = CSS.supports('field-sizing', 'content');
import type { GraphText, GraphWord } from '../../../../schema/component/kind/word-graph';

const buildTextColContent = (
  items: GraphText[],
  colIndex: number,
  ctx: ColContext,
): HTMLElement => {
  const { state } = ctx;
  const contextWordId = colIndex > 0 ? (state.path[colIndex - 1] ?? '') : '';

  const col = document.createElement('div');
  col.style.display = 'flex';
  col.style.flexDirection = 'column';
  col.style.flex = '1';
  col.style.minHeight = '0';
  col.style.overflowY = 'auto';
  col.style.padding = '4px 0';

  // Column header: type label + lang toggle (col0 only)
  const headerRow = document.createElement('div');
  Object.assign(headerRow.style, {
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px 2px 12px',
    flexShrink: '0',
    gap: '6px',
  });

  const typeLabel = document.createElement('div');
  Object.assign(typeLabel.style, {
    fontSize: '10px',
    color: theme.textFaint,
    userSelect: 'none',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flex: '1',
  });
  typeLabel.textContent = colIndex === 0 ? 'texts' : 'related texts';
  headerRow.appendChild(typeLabel);

  if (colIndex === 0) {
    const toggleWrap = document.createElement('div');
    Object.assign(toggleWrap.style, {
      display: 'flex',
      gap: '2px',
      flexShrink: '0',
    });
    for (const lng of ['en', 'ja'] as const) {
      const btn = document.createElement('button');
      btn.textContent = lng.toUpperCase();
      const isActive = state.lang === lng;
      Object.assign(btn.style, {
        fontSize: '10px',
        padding: '0 5px',
        border: isActive ? `1px solid ${theme.borderStrong}` : `1px solid ${theme.borderFaint}`,
        borderRadius: '3px',
        background: isActive ? theme.selectSubtle : 'transparent',
        color: isActive ? theme.textHigh : theme.textFaint,
        cursor: 'pointer',
        lineHeight: '1.6',
        userSelect: 'none',
      });
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (state.lang === lng) return;
        state.lang = lng;
        state.inputCache.clear();
        ctx.render();
      });
      toggleWrap.appendChild(btn);
    }
    headerRow.appendChild(toggleWrap);
  }

  col.appendChild(headerRow);

  // Draft input row
  const draftRow = document.createElement('div');
  draftRow.style.display = 'flex';
  draftRow.style.alignItems = 'flex-start';
  draftRow.style.gap = '4px';
  draftRow.style.padding = '1px 8px 1px 12px';
  draftRow.style.flexShrink = '0';

  const draftMarker = document.createElement('span');
  Object.assign(draftMarker.style, {
    width: '6px',
    height: '6px',
    flexShrink: '0',
    alignSelf: 'center',
    borderRadius: '1px',
    boxSizing: 'border-box',
    background: 'transparent',
    border: `1.5px solid ${theme.borderStrong}`,
  });

  const draftInput = document.createElement('textarea');
  draftInput.rows = 1;
  draftInput.dataset.navInput = 'draft';
  draftInput.dataset.columnIndex = String(colIndex);
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
    color: theme.textDim,
  });
  (draftInput.style as unknown as Record<string, string>)['field-sizing'] = 'content';
  if (colIndex > 0 && !contextWordId) {
    draftInput.placeholder = 'select a word first';
    draftInput.style.opacity = '0.35';
  }

  draftInput.addEventListener('input', () => {
    draftInput.style.height = 'auto';
    draftInput.style.height = `${draftInput.scrollHeight}px`;
  });

  draftInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = draftInput.value.trim();
      if (!text) return;
      if (colIndex > 0 && !contextWordId) return;
      ctx.pushHistory();
      const newText: GraphText = { id: randomId(), wordIds: [] };
      setLangText(newText, state.lang, text);
      if (colIndex > 0 && contextWordId) {
        newText.wordIds.push(contextWordId);
      }
      state.texts.unshift(newText);
      state.path = [...state.path.slice(0, colIndex), newText.id];
      state.pendingFocusId = newText.id;
      state.pendingFocusColumn = colIndex;
      draftInput.value = '';
      draftInput.style.height = 'auto';
      ctx.scheduleSave();
      ctx.render();
      return;
    }
    if (e.key === 'ArrowDown') {
      const onLastLine = !draftInput.value.slice(draftInput.selectionStart ?? draftInput.value.length).includes('\n');
      if (!onLastLine) return;
      e.preventDefault();
      const graphId = ctx.outer.dataset.graphId ?? '';
      const colInputs = Array.from(
        document.querySelectorAll<HTMLTextAreaElement>(
          `[data-graph-id="${CSS.escape(graphId)}"] [data-nav-input][data-column-index="${colIndex}"]`,
        ),
      ).filter(inp => inp.offsetParent !== null);
      const pos = colInputs.indexOf(draftInput);
      if (pos < colInputs.length - 1) colInputs[pos + 1].focus({ preventScroll: true });
    }
  });

  draftRow.appendChild(draftMarker);
  draftRow.appendChild(draftInput);
  col.appendChild(draftRow);

  // wordId → color lookup
  const wordColorById = new Map<string, string>(
    state.words.filter((w) => w.color).map((w) => [w.id, w.color!]),
  );

  // Item rows
  for (const item of items) {
    // Highlight if selected in this column's path slot, or if col0 and the same
    // text is selected in the related-texts column (col2 path slot).
    const isInPath = state.path[colIndex] === item.id ||
      (colIndex === 0 && state.path[2] === item.id);
    const textColor = item.wordIds.map((id) => wordColorById.get(id)).find(Boolean) ?? null;

    const row = document.createElement('div');
    row.dataset.nodeRow = item.id;
    row.style.display = 'flex';
    row.style.alignItems = 'flex-start';
    row.style.gap = '4px';
    row.style.padding = '1px 8px 1px 12px';
    row.style.background = isInPath ? theme.selectSubtle : 'transparent';
    row.style.flexShrink = '0';

    const cacheKey = `${colIndex}:${item.id}`;
    let inp = state.inputCache.get(cacheKey);
    if (!inp) {
      inp = createInput(item, colIndex, null, ctx as unknown as import('./types').WordGraphContext);
      state.inputCache.set(cacheKey, inp);
    }
    const activeText = state.lang === 'en' ? (item.en ?? '') : (item.ja ?? '');
    const fallbackText = state.lang === 'en' ? (item.ja ?? '') : (item.en ?? '');
    const hasPrimary = hasPrimaryLang(item, state.lang);
    if (inp.value !== activeText) inp.value = activeText;
    inp.placeholder = fallbackText;
    inp.dataset.columnIndex = String(colIndex);
    inp.style.background = 'transparent';
    inp.style.color = textColor ?? (hasPrimary ? 'inherit' : theme.textDim);
    inp.style.fontStyle = 'normal';
    inp.style.borderRadius = '0';

    const wordCount = (item as GraphText).wordIds?.length ?? 0;
    const hasLinks = wordCount > 0;
    const markerColor = textColor ?? theme.markerDefault;
    const marker = document.createElement('span');
    Object.assign(marker.style, {
      width: '6px',
      height: '6px',
      flexShrink: '0',
      alignSelf: 'center',
      borderRadius: '1px',
      boxSizing: 'border-box',
      background: hasLinks ? markerColor : 'transparent',
      border: hasLinks ? 'none' : `1.5px solid ${markerColor}`,
    });

    row.appendChild(marker);
    row.appendChild(inp);

    if (hasLinks) {
      const countLabel = document.createElement('span');
      countLabel.textContent = String(wordCount);
      Object.assign(countLabel.style, {
        fontSize: '10px',
        color: theme.textFaint,
        userSelect: 'none',
        flexShrink: '0',
        alignSelf: 'center',
      });
      row.appendChild(countLabel);

      const arrow = document.createElement('span');
      arrow.textContent = '›';
      Object.assign(arrow.style, {
        userSelect: 'none',
        color: textColor ?? theme.textFaint,
        fontSize: '14px',
        flexShrink: '0',
        paddingRight: '2px',
        alignSelf: 'center',
      });
      row.appendChild(arrow);
    }

    col.appendChild(row);
  }

  return col;
};

export const renderWordGraphTextCol = (
  id: string,
  component: WordGraphTextColComponent,
): HTMLElement => {
  const outer = document.createElement('div');
  outer.dataset.frameId = id;
  outer.dataset.graphId = component.graphId;
  outer.style.overflow = 'hidden';
  outer.style.display = 'flex';
  outer.style.flexDirection = 'column';
  outer.style.boxSizing = 'border-box';
  outer.style.fontSize = '13px';
  outer.style.lineHeight = '1.5';
  outer.style.background = theme.bg;
  outer.style.color = theme.textHigh;
  outer.style.borderRight = `1px solid ${theme.borderStrong}`;
  applyCssProps(outer, component as unknown as Record<string, unknown>);

  const shared = getOrCreateGraphState(component.graphId);
  const colIndex = component.colIndex;

  const state = shared;

  const scheduleSave = (): void => {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      state.saveTimer = null;
      void fetch(`/api/graph/${encodeURIComponent(component.graphId)}`, {
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

  const notify = (): void => {
    shared.subscribers.forEach((fn) => fn());
  };

  const focusPending = (): void => {
    if (!state.pendingFocusId) return;
    const fid = state.pendingFocusId;
    const fcol = state.pendingFocusColumn;
    const cursorPos = state.pendingFocusCursorPos;
    // Search only within this column's own container so that a sibling column's
    // focusPending call does not consume the pending focus for a different column
    // (which would focus a stale DOM element that gets removed when the target
    // column re-renders, causing the cursor to vanish).
    const selector = fcol !== null
      ? `[data-node-id="${CSS.escape(fid)}"][data-column-index="${fcol}"]`
      : `[data-node-id="${CSS.escape(fid)}"]`;
    const el = outer.querySelector<HTMLTextAreaElement>(selector);
    if (!el) return;
    state.pendingFocusId = null;
    state.pendingFocusColumn = null;
    state.pendingFocusCursorPos = null;
    el.focus({ preventScroll: true });
    if (cursorPos !== null) {
      el.selectionStart = cursorPos;
      el.selectionEnd = cursorPos;
    }
  };

  const render = (): void => {
    const prevCol = outer.firstElementChild as HTMLElement | null;
    const scrollTop = prevCol ? prevCol.scrollTop : 0;

    let items: GraphText[];
    if (colIndex === 0) {
      items = state.texts;
    } else {
      // colIndex === 2: texts linked to the word selected in path[1]
      // or if path[0] is a word (all-words view), texts linked to that word
      const wordId = state.path[1]
        ? (findWord(state.words, state.path[1]) ? state.path[1] : null)
        : (!findText(state.texts, state.path[0] ?? '') && state.path[0] && findWord(state.words, state.path[0])
          ? state.path[0]
          : null);
      items = wordId ? state.texts.filter((t) => t.wordIds.includes(wordId)) : [];
    }

    const ctx: ColContext = {
      id,
      outer,
      state,
      scheduleSave,
      pushHistory,
      render: notify,
      scheduleRender: () => requestAnimationFrame(notify),
    };

    outer.replaceChildren(buildTextColContent(items, colIndex, ctx));

    if (!supportsFieldSizing) {
      const tas = Array.from(outer.querySelectorAll<HTMLTextAreaElement>('textarea[data-nav-input]'));
      for (const ta of tas) ta.style.height = 'auto';
      const heights = tas.map(ta => ta.scrollHeight);
      for (let i = 0; i < tas.length; i++) tas[i].style.height = `${heights[i]}px`;
    }

    const newCol = outer.firstElementChild as HTMLElement | null;
    if (newCol) newCol.scrollTop = scrollTop;

    focusPending();
  };

  shared.subscribers.add(render);

  // Load data once per graphId
  if (!shared.loaded) {
    shared.loaded = true;
    const base = `/api/graph/${encodeURIComponent(component.graphId)}`;
    void Promise.all([
      fetch(`${base}/words`).then((r) => r.ok ? r.json() as Promise<unknown> : { words: [] }),
      fetch(`${base}/texts`).then((r) => r.ok ? r.json() as Promise<unknown> : { texts: [] }),
    ])
      .then(([wordsData, textsData]) => {
        const wd = wordsData as Record<string, unknown>;
        const td = textsData as Record<string, unknown>;
        shared.words = Array.isArray(wd.words) ? (wd.words as typeof shared.words) : [];
        shared.texts = Array.isArray(td.texts) ? (td.texts as typeof shared.texts) : [];
        notify();
      })
      .catch(() => notify());
  } else {
    render();
  }

  return outer;
};
