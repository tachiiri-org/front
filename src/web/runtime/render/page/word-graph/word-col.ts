import type { WordGraphWordColComponent } from '../../../../schema/component/kind/word-graph-col';
import { applyCssProps, cloneData, findText, findWord, randomId } from './ops';
import { getOrCreateGraphState } from './store';
import type { ColContext } from './types';
import { createInput } from './input';
import { theme } from '../theme';
import type { GraphText, GraphWord } from '../../../../schema/component/kind/word-graph';

const COL_INDEX = 1;

const buildWordColContent = (
  items: GraphWord[],
  contextTextId: string | null,
  ctx: ColContext,
  unlinkedItems?: GraphWord[],
): HTMLElement => {
  const { state } = ctx;

  const col = document.createElement('div');
  col.style.display = 'flex';
  col.style.flexDirection = 'column';
  col.style.flex = '1';
  col.style.minHeight = '0';
  col.style.overflowY = 'auto';
  col.style.padding = '4px 0';

  const typeLabel = document.createElement('div');
  Object.assign(typeLabel.style, {
    fontSize: '10px',
    color: theme.textFaint,
    padding: '0 12px 2px',
    userSelect: 'none',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: '0',
  });
  typeLabel.textContent = 'words';
  col.appendChild(typeLabel);

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
      item.textContent = word.text;
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
    suggestions = state.words.filter((w) => !alreadyLinked.has(w.id) && w.text.toLowerCase().includes(q));
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
      const existing = state.words.find((w) => w.text === text);
      const targetWord = existing ?? ((): GraphWord => {
        const w: GraphWord = { id: randomId(), text };
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

  // Item rows
  for (const item of items) {
    const isInPath = state.path[COL_INDEX] === item.id;
    const isProposed = (item as { status?: string }).status === 'proposed';
    const isIssue = (item as { type?: string }).type === 'issue' || item.text.startsWith('?');
    const isTask = (item as { type?: string }).type === 'task';

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
    if (inp.value !== item.text) inp.value = item.text;
    inp.dataset.columnIndex = String(COL_INDEX);
    inp.style.background = isIssue ? theme.issueBg : isTask ? theme.taskBg : isProposed ? theme.proposedBg : 'transparent';
    inp.style.color = isIssue ? theme.issueText : isTask ? theme.taskText : isProposed ? theme.proposedText : 'inherit';
    inp.style.fontStyle = isProposed ? 'italic' : 'normal';
    inp.style.borderRadius = isIssue || isTask || isProposed ? '3px' : '0';

    const linkedTextCount = state.texts.filter((t) => t.wordIds.includes(item.id)).length;
    const hasLinks = linkedTextCount > 0;
    const markerColor = isIssue ? theme.issueMarkerBright : isTask ? theme.taskMarkerBright : isProposed ? theme.proposedMarkerBright : theme.markerDefault;
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
      countLabel.textContent = String(linkedTextCount);
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
        color: isIssue ? theme.issueAccent : isTask ? theme.taskAccent : isProposed ? theme.proposedAccent : theme.textFaint,
        fontSize: '14px',
        flexShrink: '0',
        paddingRight: '2px',
        alignSelf: 'center',
      });
      row.appendChild(arrow);
    }

    col.appendChild(row);
  }

  if (unlinkedItems && unlinkedItems.length > 0) {
    const separator = document.createElement('div');
    Object.assign(separator.style, {
      margin: '4px 12px',
      height: '1px',
      background: theme.borderFaint,
      flexShrink: '0',
    });
    col.appendChild(separator);

    for (const item of unlinkedItems) {
      const isInPath = state.path[COL_INDEX] === item.id;
      const isProposed = (item as { status?: string }).status === 'proposed';
      const isIssue = (item as { type?: string }).type === 'issue' || item.text.startsWith('?');
      const isTask = (item as { type?: string }).type === 'task';

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
        inp = createInput(item, COL_INDEX, null, ctx as unknown as import('./types').WordGraphContext);
        state.inputCache.set(cacheKey, inp);
      }
      if (inp.value !== item.text) inp.value = item.text;
      inp.dataset.columnIndex = String(COL_INDEX);
      inp.style.background = isIssue ? theme.issueBg : isTask ? theme.taskBg : isProposed ? theme.proposedBg : 'transparent';
      inp.style.color = isIssue ? theme.issueText : isTask ? theme.taskText : isProposed ? theme.proposedText : theme.textDim;
      inp.style.fontStyle = isProposed ? 'italic' : 'normal';
      inp.style.borderRadius = isIssue || isTask || isProposed ? '3px' : '0';

      const linkedTextCount = state.texts.filter((t) => t.wordIds.includes(item.id)).length;
      const hasLinks = linkedTextCount > 0;
      const markerColor = isIssue ? theme.issueMarkerBright : isTask ? theme.taskMarkerBright : isProposed ? theme.proposedMarkerBright : theme.textFaint;
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
        countLabel.textContent = String(linkedTextCount);
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
          color: isIssue ? theme.issueAccent : isTask ? theme.taskAccent : isProposed ? theme.proposedAccent : theme.textFaint,
          fontSize: '14px',
          flexShrink: '0',
          paddingRight: '2px',
          alignSelf: 'center',
        });
        row.appendChild(arrow);
      }

      col.appendChild(row);
    }
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
      void fetch(`/api/word-graphs/${encodeURIComponent(component.graphId)}`, {
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
    state.pendingFocusId = null;
    state.pendingFocusColumn = null;
    const graphId = component.graphId;
    const selector = fcol !== null
      ? `[data-graph-id="${CSS.escape(graphId)}"] [data-node-id="${CSS.escape(fid)}"][data-column-index="${fcol}"]`
      : `[data-graph-id="${CSS.escape(graphId)}"] [data-node-id="${CSS.escape(fid)}"]`;
    const el = document.querySelector<HTMLTextAreaElement>(selector);
    if (!el) return;
    el.focus({ preventScroll: true });
  };

  const render = (): void => {
    const prevCol = outer.firstElementChild as HTMLElement | null;
    const scrollTop = prevCol ? prevCol.scrollTop : 0;

    const col1TextId = state.path.length >= 1 && findText(state.texts, state.path[0])
      ? state.path[0]
      : null;

    let items: GraphWord[];
    let contextTextId: string | null = null;
    let unlinkedItems: GraphWord[] | undefined;
    if (col1TextId) {
      contextTextId = col1TextId;
      const text = findText(state.texts, col1TextId);
      const linkedIds = new Set(text ? text.wordIds : []);
      items = text
        ? text.wordIds.map((wid) => findWord(state.words, wid)).filter((w): w is GraphWord => w !== undefined)
        : [];
      unlinkedItems = state.words.filter((w) => !linkedIds.has(w.id));
    } else {
      items = [...state.words];
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

    outer.replaceChildren(buildWordColContent(items, contextTextId, ctx, unlinkedItems));

    for (const ta of outer.querySelectorAll<HTMLTextAreaElement>('textarea[data-nav-input]')) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }

    const newCol = outer.firstElementChild as HTMLElement | null;
    if (newCol) newCol.scrollTop = scrollTop;

    focusPending();
  };

  shared.subscribers.add(render);

  if (!shared.loaded) {
    shared.loaded = true;
    void fetch(`/api/word-graphs/${encodeURIComponent(component.graphId)}`)
      .then((res) => res.ok ? (res.json() as Promise<unknown>) : Promise.resolve({ texts: [], words: [] }))
      .then((data) => {
        const d = data as Record<string, unknown>;
        shared.texts = Array.isArray(d.texts) ? (d.texts as GraphText[]) : [];
        shared.words = Array.isArray(d.words) ? (d.words as GraphWord[]) : [];
        notify();
      })
      .catch(() => notify());
  } else {
    render();
  }

  return outer;
};
