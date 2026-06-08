import type { WordGraphWordColComponent } from '../../../../schema/component/kind/word-graph-col';
import { applyCssProps, cloneData, findText, findWord, randomId, migrateGraphData, getLangText, hasPrimaryLang, setLangText, findWordByText, wordMatchesQuery } from './ops';
import { getOrCreateGraphState } from './store';
import type { ColContext } from './types';
import { createInput } from './input';
import { theme } from '../theme';

const supportsFieldSizing = CSS.supports('field-sizing', 'content');
import type { GraphText, GraphWord } from '../../../../schema/component/kind/word-graph';

const COL_INDEX = 1;

const PRESET_COLORS: Array<string | null> = [
  'rgba(255,190,60,0.90)',
  'rgba(200,120,255,0.90)',
  'rgba(60,220,120,0.90)',
  'rgba(80,160,255,0.90)',
  'rgba(255,100,100,0.90)',
  'rgba(60,220,220,0.90)',
  null,
];

const showColorPicker = (
  anchor: HTMLElement,
  wordId: string,
  ctx: ColContext,
): void => {
  document.querySelector('.wg-color-picker')?.remove();

  const { state } = ctx;
  const picker = document.createElement('div');
  picker.className = 'wg-color-picker';
  Object.assign(picker.style, {
    position: 'fixed',
    display: 'flex',
    gap: '4px',
    padding: '6px',
    background: '#2a2a2a',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    zIndex: '1000',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  });

  for (const color of PRESET_COLORS) {
    const swatch = document.createElement('div');
    Object.assign(swatch.style, {
      width: '16px',
      height: '16px',
      borderRadius: '3px',
      cursor: 'pointer',
      flexShrink: '0',
      background: color ?? 'transparent',
      border: color ? 'none' : '1px solid rgba(255,255,255,0.35)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '11px',
      color: 'rgba(255,255,255,0.55)',
    });
    if (!color) swatch.textContent = '×';
    swatch.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ctx.pushHistory();
      const w = state.words.find((x) => x.id === wordId);
      if (w) {
        if (color) w.color = color;
        else delete w.color;
      }
      ctx.scheduleSave();
      ctx.render();
      picker.remove();
    });
    picker.appendChild(swatch);
  }

  const rect = anchor.getBoundingClientRect();
  picker.style.top = `${rect.bottom + 4}px`;
  picker.style.left = `${rect.left}px`;
  document.body.appendChild(picker);

  const dismiss = (e: MouseEvent): void => {
    if (!picker.contains(e.target as Node)) {
      picker.remove();
      document.removeEventListener('mousedown', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
};

const buildWordColContent = (
  items: GraphWord[],
  contextTextId: string | null,
  linkedIds: Set<string> | null,
  ctx: ColContext,
): HTMLElement => {
  const { state } = ctx;

  const col = document.createElement('div');
  col.style.display = 'flex';
  col.style.flexDirection = 'column';
  col.style.flex = '1';
  col.style.minHeight = '0';
  col.style.overflowY = 'auto';
  col.style.padding = '4px 0';

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
  typeLabel.textContent = 'words';
  headerRow.appendChild(typeLabel);

  const toggleWrap = document.createElement('div');
  Object.assign(toggleWrap.style, { display: 'flex', gap: '2px', flexShrink: '0' });
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

  col.appendChild(headerRow);

  // Draft input
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
  draftInput.dataset.columnIndex = String(COL_INDEX);
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

  // Suggestion list
  let activeIndex = -1;
  let suggestions: GraphWord[] = [];

  const suggestionsEl = document.createElement('div');
  Object.assign(suggestionsEl.style, {
    display: 'none',
    flexDirection: 'column',
    maxHeight: '120px',
    overflowY: 'auto',
    flexShrink: '0',
    borderTop: `1px solid ${theme.borderFaint}`,
    borderBottom: `1px solid ${theme.borderFaint}`,
    margin: '0 0 2px',
  });

  const commitWord = (word: GraphWord): void => {
    ctx.pushHistory();
    if (!state.words.find((w) => w.id === word.id)) state.words.push(word);
    if (contextTextId) {
      const contextText = findText(state.texts, contextTextId);
      if (contextText && !contextText.wordIds.includes(word.id)) {
        contextText.wordIds.push(word.id);
      }
    }
    state.pendingFocusId = word.id;
    state.pendingFocusColumn = COL_INDEX;
    draftInput.value = '';
    draftInput.style.height = 'auto';
    suggestionsEl.style.display = 'none';
    activeIndex = -1;
    ctx.scheduleSave();
    ctx.render();
  };

  const renderSuggestions = (): void => {
    suggestionsEl.replaceChildren();
    if (!suggestions.length) { suggestionsEl.style.display = 'none'; return; }
    suggestionsEl.style.display = 'flex';
    suggestions.forEach((word, i) => {
      const item = document.createElement('div');
      item.textContent = getLangText(word, state.lang);
      const isActive = i === activeIndex;
      Object.assign(item.style, {
        padding: '2px 12px 2px 22px',
        cursor: 'pointer',
        flexShrink: '0',
        background: isActive ? theme.selectSubtle : 'transparent',
        color: isActive ? theme.textHigh : theme.textMid,
        userSelect: 'none',
      });
      item.addEventListener('mousedown', (e) => { e.preventDefault(); commitWord(word); });
      item.addEventListener('mouseenter', () => {
        activeIndex = i;
        renderSuggestions();
      });
      suggestionsEl.appendChild(item);
    });
  };

  const updateSuggestions = (): void => {
    const q = draftInput.value.trim().toLowerCase();
    const alreadyLinked = contextTextId
      ? new Set((findText(state.texts, contextTextId)?.wordIds ?? []))
      : new Set<string>();
    if (!q) {
      suggestions = [];
      activeIndex = -1;
      suggestionsEl.style.display = 'none';
      return;
    }
    suggestions = state.words.filter((w) => !alreadyLinked.has(w.id) && wordMatchesQuery(w, q));
    activeIndex = -1;
    renderSuggestions();
  };

  draftInput.addEventListener('input', () => {
    draftInput.style.height = 'auto';
    draftInput.style.height = `${draftInput.scrollHeight}px`;
    updateSuggestions();
  });

  draftInput.addEventListener('blur', () => {
    setTimeout(() => { suggestionsEl.style.display = 'none'; activeIndex = -1; }, 150);
  });

  draftInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      suggestions = [];
      activeIndex = -1;
      suggestionsEl.style.display = 'none';
      return;
    }
    if (e.key === 'ArrowDown' && suggestionsEl.style.display !== 'none') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, suggestions.length - 1);
      renderSuggestions();
      return;
    }
    if (e.key === 'ArrowUp' && suggestionsEl.style.display !== 'none') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, -1);
      renderSuggestions();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        commitWord(suggestions[activeIndex]);
        return;
      }
      const text = draftInput.value.trim();
      if (!text) return;
      ctx.pushHistory();
      const existing = findWordByText(state.words, text);
      const targetWord = existing ?? ((): GraphWord => {
        const w: GraphWord = { id: randomId() };
        setLangText(w, state.lang, text);
        state.words.push(w);
        return w;
      })();
      if (contextTextId) {
        const contextText = findText(state.texts, contextTextId);
        if (contextText && !contextText.wordIds.includes(targetWord.id)) {
          contextText.wordIds.push(targetWord.id);
        }
      }
      state.pendingFocusId = targetWord.id;
      state.pendingFocusColumn = COL_INDEX;
      draftInput.value = '';
      draftInput.style.height = 'auto';
      suggestionsEl.style.display = 'none';
      activeIndex = -1;
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
          `[data-graph-id="${CSS.escape(graphId)}"] [data-nav-input][data-column-index="${COL_INDEX}"]`,
        ),
      ).filter(inp => inp.offsetParent !== null);
      const pos = colInputs.indexOf(draftInput);
      if (pos < colInputs.length - 1) colInputs[pos + 1].focus({ preventScroll: true });
    }
  });

  draftRow.appendChild(draftMarker);
  draftRow.appendChild(draftInput);
  col.appendChild(draftRow);
  col.appendChild(suggestionsEl);

  // Item rows — all words in fixed global order, dimmed if not linked to selected text
  for (const item of items) {
    const isInPath = state.path[COL_INDEX] === item.id;
    const isLinked = linkedIds === null || linkedIds.has(item.id);
    const rawColor = item.color ?? null;
    const fadedItemColor = rawColor ? rawColor.replace(/,\s*([\d.]+)\)$/, ', 0.25)') : null;
    const wordColor = isLinked ? rawColor : fadedItemColor;
    const markerColor = isLinked ? (rawColor ?? theme.markerDefault) : (fadedItemColor ?? theme.textFaint);

    const row = document.createElement('div');
    row.dataset.nodeRow = item.id;
    row.style.display = 'flex';
    row.style.alignItems = 'flex-start';
    row.style.gap = '4px';
    row.style.padding = '1px 8px 1px 12px';
    row.style.background = isInPath ? theme.selectSubtle : 'transparent';
    row.style.flexShrink = '0';

    const cacheKey = `${COL_INDEX}:${item.id}`;
    let inp = state.inputCache.get(cacheKey);
    if (!inp) {
      inp = createInput(item, COL_INDEX, contextTextId, ctx as unknown as import('./types').WordGraphContext);
      state.inputCache.set(cacheKey, inp);
    }
    const activeText = state.lang === 'en' ? (item.en ?? '') : (item.ja ?? '');
    const fallbackText = state.lang === 'en' ? (item.ja ?? '') : (item.en ?? '');
    const hasPrimary = hasPrimaryLang(item, state.lang);
    if (inp.value !== activeText) inp.value = activeText;
    inp.placeholder = fallbackText;
    inp.dataset.columnIndex = String(COL_INDEX);
    inp.style.background = 'transparent';
    inp.style.color = wordColor ?? (isLinked ? (hasPrimary ? 'inherit' : theme.textDim) : theme.textDim);
    inp.style.fontStyle = hasPrimary ? 'normal' : 'italic';
    inp.style.borderRadius = '0';

    const linkedTextCount = state.texts.filter((t) => t.wordIds.includes(item.id)).length;
    const hasLinks = linkedTextCount > 0;
    const marker = document.createElement('span');
    Object.assign(marker.style, {
      width: '8px',
      height: '8px',
      flexShrink: '0',
      alignSelf: 'center',
      borderRadius: '2px',
      boxSizing: 'border-box',
      background: hasLinks ? markerColor : 'transparent',
      border: hasLinks ? 'none' : `1.5px solid ${markerColor}`,
      cursor: 'pointer',
    });
    marker.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 2) {
        showColorPicker(marker, item.id, ctx);
      } else if (e.button === 0 && contextTextId) {
        ctx.pushHistory();
        const text = findText(state.texts, contextTextId);
        if (text) {
          if (text.wordIds.includes(item.id)) {
            text.wordIds = text.wordIds.filter((id) => id !== item.id);
          } else {
            text.wordIds.push(item.id);
          }
          ctx.scheduleSave();
          ctx.render();
        }
      }
    });
    marker.addEventListener('contextmenu', (e) => e.preventDefault());

    row.appendChild(marker);
    row.appendChild(inp);

    col.appendChild(row);
  }

  return col;
};

export const renderWordGraphWordCol = (
  id: string,
  component: WordGraphWordColComponent,
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

    const col1TextId = state.path.length >= 1 && findText(state.texts, state.path[0])
      ? state.path[0]
      : null;

    // When a related text (col2) is selected, highlight its words rather than col0's.
    const col3TextId = state.path[2] && findText(state.texts, state.path[2])
      ? state.path[2]
      : null;
    const contextTextId = col3TextId ?? col1TextId;
    const linkedIds = contextTextId
      ? new Set(findText(state.texts, contextTextId)?.wordIds ?? [])
      : null;
    const items = [...state.words].sort((a, b) =>
      getLangText(a, state.lang).localeCompare(getLangText(b, state.lang)));

    const ctx: ColContext = {
      id,
      outer,
      state,
      scheduleSave,
      pushHistory,
      render: notify,
      scheduleRender: () => requestAnimationFrame(notify),
    };

    outer.replaceChildren(buildWordColContent(items, contextTextId, linkedIds, ctx));

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
