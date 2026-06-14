import type { GraphText, GraphWord } from '../../../../schema/component/kind/word-graph';
import type { WordGraphContext } from './types';
import { randomId, findText, findWord, isTextColumn, getLangText, hasPrimaryLang, setLangText, findWordByText } from './ops';
import { createInput } from './input';
import { theme } from '../theme';


const buildColumn = (
  items: (GraphText | GraphWord)[],
  colIndex: number,
  contextTextId: string | null,
  ctx: WordGraphContext,
): HTMLElement => {
  const { state } = ctx;
  const isTextCol = isTextColumn(colIndex);

  const col = document.createElement('div');
  col.dataset.colIndex = String(colIndex);
  if (isTextCol) {
    col.style.width = '30vw';
    col.style.minWidth = '180px';
  } else {
    col.style.width = '15vw';
    col.style.minWidth = '120px';
  }
  col.style.borderRight = `1px solid ${theme.borderStrong}`;
  col.style.overflowY = 'auto';
  col.style.overflowX = 'hidden';
  col.style.flexShrink = '0';
  col.style.boxSizing = 'border-box';
  col.style.padding = '4px 0';

  // Column type label (+ lang toggle for word column)
  const headerRow = document.createElement('div');
  Object.assign(headerRow.style, {
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px 2px 12px',
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
  typeLabel.textContent = isTextCol ? 'texts' : 'words';
  headerRow.appendChild(typeLabel);

  if (!isTextCol) {
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
  }

  col.appendChild(headerRow);

  // Draft input row (text and word columns share same textarea UI)
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

  draftInput.addEventListener('input', () => {
    draftInput.style.height = 'auto';
    draftInput.style.height = `${draftInput.scrollHeight}px`;
  });

  draftInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = draftInput.value.trim();
      if (!text) return;
      ctx.pushHistory();
      if (isTextCol) {
        const contextWordId = colIndex > 0 ? (state.path[colIndex - 1] ?? '') : '';
        if (colIndex > 0 && !contextWordId) return;
        const newText: GraphText = { id: randomId(), wordIds: [] };
        setLangText(newText, state.lang, text);
        if (colIndex > 0 && contextWordId) {
          newText.wordIds.push(contextWordId);
        }
        state.texts.unshift(newText);
        state.path = [...state.path.slice(0, colIndex), newText.id];
        state.pendingFocusId = newText.id;
        state.pendingFocusColumn = colIndex;
      } else {
        const existing = findWordByText(state.words, text);
        const newWord: GraphWord = existing ?? (() => {
          const w: GraphWord = { id: randomId() };
          setLangText(w, state.lang, text);
          return w;
        })();
        if (!existing) state.words.push(newWord);
        if (contextTextId) {
          const contextText = findText(state.texts, contextTextId);
          if (contextText) contextText.wordIds.push(newWord.id);
        }
        state.pendingFocusId = newWord.id;
        state.pendingFocusColumn = colIndex;
      }
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
      const colInputs = Array.from(ctx.outer.querySelectorAll<HTMLTextAreaElement>(`[data-nav-input][data-column-index="${colIndex}"]`)).filter(inp => inp.offsetParent !== null);
      const pos = colInputs.indexOf(draftInput);
      if (pos < colInputs.length - 1) colInputs[pos + 1].focus({ preventScroll: true });
    }
  });

  draftRow.appendChild(draftMarker);
  draftRow.appendChild(draftInput);
  col.appendChild(draftRow);

  const withAlpha = (color: string, alpha: number): string =>
    color.replace(/,\s*[\d.]+\)$/, `, ${alpha})`);

  // For the word column (col1): determine context text for dimming unrelated words
  const contextText = !isTextCol && contextTextId
    ? findText(ctx.state.texts, contextTextId)
    : null;

  // Item rows
  for (const item of items) {
    const isInPath = state.path[colIndex] === item.id ||
      (state.focusedId === item.id && state.focusedColumn === colIndex);
    const wordIds = 'wordIds' in item ? (item as GraphText).wordIds : [];
    const accentColor = isTextCol
      ? (wordIds.map((id) => state.words.find((w) => w.id === id)?.color).find(Boolean) ?? null)
      : ((item as GraphWord).color ?? null);

    const row = document.createElement('div');
    row.dataset.nodeRow = item.id;
    row.dataset.inPath = isInPath ? 'true' : 'false';
    row.style.display = 'flex';
    row.style.alignItems = 'flex-start';
    row.style.gap = '4px';
    row.style.padding = '1px 8px 1px 12px';
    row.style.background = isInPath ? theme.selectSubtle : 'transparent';
    // Dim words not linked to the context text (col0 selection)
    if (contextText && !isTextCol) {
      row.style.opacity = contextText.wordIds.includes(item.id) ? '1' : '0.35';
    }

    const cacheKey = `${colIndex}:${item.id}`;
    let inp = state.inputCache.get(cacheKey);
    if (!inp) {
      inp = createInput(item, colIndex, contextTextId, ctx);
      state.inputCache.set(cacheKey, inp);
    }
    const activeText = state.lang === 'en' ? (item.en ?? '') : (item.ja ?? '');
    const fallbackText = state.lang === 'en' ? (item.ja ?? '') : (item.en ?? '');
    const hasPrimary = hasPrimaryLang(item, state.lang);
    if (inp.value !== activeText) inp.value = activeText;
    inp.placeholder = fallbackText;
    inp.dataset.columnIndex = String(colIndex);
    inp.style.background = accentColor ? withAlpha(accentColor, 0.10) : 'transparent';
    inp.style.color = accentColor ?? (hasPrimary ? 'inherit' : theme.textDim);
    inp.style.fontStyle = 'normal';
    inp.style.borderRadius = accentColor ? '3px' : '0';

    const markerColor = accentColor ? withAlpha(accentColor, 0.70) : theme.markerDefault;
    const marker = document.createElement('span');
    Object.assign(marker.style, {
      width: '6px',
      height: '6px',
      flexShrink: '0',
      alignSelf: 'center',
      borderRadius: '1px',
      boxSizing: 'border-box',
      background: 'transparent',
      border: `1.5px solid ${markerColor}`,
    });

    row.appendChild(marker);
    row.appendChild(inp);

    // Arrow indicator: text has words, or word has texts
    const hasLinks = isTextCol
      ? ((item as GraphText).wordIds?.length ?? 0) > 0
      : state.texts.some((t) => t.wordIds.includes(item.id));

    if (hasLinks) {
      const arrow = document.createElement('span');
      arrow.textContent = '›';
      Object.assign(arrow.style, {
        userSelect: 'none',
        color: accentColor ? withAlpha(accentColor, 0.50) : theme.textFaint,
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

export const buildColumns = (ctx: WordGraphContext): HTMLElement => {
  const { state } = ctx;

  const wrapper = document.createElement('div');
  wrapper.dataset.columnsWrapper = 'true';
  wrapper.style.display = 'flex';
  wrapper.style.flex = '1';
  wrapper.style.minHeight = '0';
  wrapper.style.overflowX = 'auto';
  wrapper.style.position = 'relative';

  // Column 0 (display): all words — colIndex=1 preserves the odd/even convention
  wrapper.appendChild(buildColumn([...state.words], 1, null, ctx));

  // Column 1 (display): texts linked to the selected word (path[1])
  if (state.path.length >= 2 && findWord(state.words, state.path[1])) {
    const col2Items = state.texts.filter(t => t.wordIds.includes(state.path[1]));
    wrapper.appendChild(buildColumn(col2Items, 2, null, ctx));
  }

  const spacer = document.createElement('div');
  spacer.dataset.columnsSpacer = 'true';
  spacer.style.flexShrink = '0';
  spacer.style.width = '0';
  wrapper.appendChild(spacer);

  // Breadcrumb
  const breadcrumb = document.createElement('div');
  Object.assign(breadcrumb.style, {
    display: 'flex',
    alignItems: 'center',
    flexShrink: '0',
    overflowX: 'auto',
    padding: '2px 8px',
    fontSize: '11px',
    borderBottom: `1px solid ${theme.borderFaint}`,
    gap: '2px',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  });

  const makeCrumb = (label: string, isCurrent: boolean): HTMLElement => {
    const el = document.createElement('span');
    el.textContent = label.length > 24 ? `${label.slice(0, 24)}…` : label;
    el.style.color = isCurrent ? theme.textHigh : theme.textLow;
    el.style.padding = '1px 2px';
    el.style.borderRadius = '2px';
    el.style.flexShrink = '0';
    return el;
  };

  breadcrumb.appendChild(makeCrumb('≡', state.path.length === 0));

  for (let i = 0; i < state.path.length; i++) {
    const id = state.path[i];
    if (!id) continue;
    const isTextIdx = i % 2 === 0;
    const entity = isTextIdx
      ? findText(state.texts, id)
      : findWord(state.words, id);
    if (!entity) break;
    const sep = document.createElement('span');
    sep.textContent = '›';
    sep.style.color = theme.textFaint;
    sep.style.flexShrink = '0';
    breadcrumb.appendChild(sep);
    breadcrumb.appendChild(makeCrumb(getLangText(entity, state.lang), i === state.path.length - 1));
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
