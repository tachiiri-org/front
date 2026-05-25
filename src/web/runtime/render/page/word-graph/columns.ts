import type { GraphText, GraphWord } from '../../../../schema/component/kind/word-graph';
import type { WordGraphContext } from './types';
import { randomId, findText, findWord, isTextColumn, getColumnItems } from './ops';
import { createInput } from './input';
import { theme } from '../theme';

const openWordSearch = (contextTextId: string, ctx: WordGraphContext): void => {
  const { state } = ctx;

  ctx.outer.querySelector('[data-word-search-overlay]')?.remove();

  const overlay = document.createElement('div');
  overlay.dataset.wordSearchOverlay = 'true';
  Object.assign(overlay.style, {
    position: 'absolute',
    inset: '0',
    background: 'rgba(0,0,0,0.35)',
    zIndex: '100',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '48px',
  });

  const dialog = document.createElement('div');
  Object.assign(dialog.style, {
    background: theme.bg,
    border: `1px solid ${theme.borderStrong}`,
    borderRadius: '4px',
    width: '240px',
    maxHeight: '300px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  });

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = '単語を検索...';
  Object.assign(searchInput.style, {
    border: 'none',
    borderBottom: `1px solid ${theme.borderStrong}`,
    outline: 'none',
    padding: '8px 10px',
    fontSize: 'inherit',
    fontFamily: 'inherit',
    background: 'transparent',
    color: theme.textHigh,
    flexShrink: '0',
  });

  const list = document.createElement('div');
  list.style.overflowY = 'auto';
  list.style.padding = '4px 0';

  const contextText = findText(state.texts, contextTextId);
  const linkedWordIds = new Set(contextText?.wordIds ?? []);

  const update = (): void => {
    const q = searchInput.value.toLowerCase();
    const matches = state.words.filter(
      (w) => !linkedWordIds.has(w.id) && (q === '' || w.text.toLowerCase().includes(q)),
    );
    list.replaceChildren(
      ...matches.map((w) => {
        const row = document.createElement('div');
        row.textContent = w.text;
        Object.assign(row.style, {
          padding: '3px 10px',
          cursor: 'pointer',
          color: theme.textHigh,
          fontSize: 'inherit',
        });
        row.addEventListener('mouseenter', () => {
          row.style.background = theme.selectSubtle;
        });
        row.addEventListener('mouseleave', () => {
          row.style.background = 'transparent';
        });
        row.addEventListener('click', () => {
          const text = findText(state.texts, contextTextId);
          if (text && !text.wordIds.includes(w.id)) {
            ctx.pushHistory();
            text.wordIds.push(w.id);
            ctx.scheduleSave();
            ctx.render();
          }
          overlay.remove();
        });
        return row;
      }),
    );
  };

  searchInput.addEventListener('input', update);

  searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      overlay.remove();
      return;
    }
    if (e.key === 'Enter') {
      const first = list.querySelector<HTMLElement>('div');
      if (first) first.click();
      return;
    }
  });

  overlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === overlay) overlay.remove();
  });

  dialog.appendChild(searchInput);
  dialog.appendChild(list);
  overlay.appendChild(dialog);
  ctx.outer.style.position = 'relative';
  ctx.outer.appendChild(overlay);

  update();
  setTimeout(() => searchInput.focus(), 0);
};

const buildColumn = (
  items: (GraphText | GraphWord)[],
  colIndex: number,
  contextTextId: string | null,
  ctx: WordGraphContext,
): HTMLElement => {
  const { state } = ctx;
  const isTextCol = isTextColumn(colIndex);

  const col = document.createElement('div');
  if (isTextCol) {
    col.style.width = '30vw';
    col.style.minWidth = '180px';
  } else {
    col.style.width = 'max-content';
    col.style.maxWidth = '30vw';
    col.style.minWidth = '180px';
  }
  col.style.borderRight = `1px solid ${theme.borderStrong}`;
  col.style.overflowY = 'auto';
  col.style.overflowX = 'hidden';
  col.style.flexShrink = '0';
  col.style.boxSizing = 'border-box';
  col.style.padding = '4px 0';

  // Column type label
  const typeLabel = document.createElement('div');
  Object.assign(typeLabel.style, {
    fontSize: '10px',
    color: theme.textFaint,
    padding: '0 12px 2px',
    userSelect: 'none',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  });
  typeLabel.textContent = isTextCol ? 'texts' : 'words';
  col.appendChild(typeLabel);

  // Draft input row
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
        const newText: GraphText = { id: randomId(), text, wordIds: [] };
        if (colIndex > 0) {
          const contextWordId = state.path[colIndex - 1];
          if (contextWordId) newText.wordIds.push(contextWordId);
        }
        state.texts.unshift(newText);
        state.path = [...state.path.slice(0, colIndex), newText.id];
        state.pendingFocusId = newText.id;
        state.pendingFocusColumn = colIndex;
      } else {
        if (!contextTextId) return;
        const newWord: GraphWord = { id: randomId(), text };
        state.words.push(newWord);
        const contextText = findText(state.texts, contextTextId);
        if (contextText) contextText.wordIds.push(newWord.id);
        state.pendingFocusId = newWord.id;
        state.pendingFocusColumn = colIndex;
      }

      draftInput.value = '';
      draftInput.style.height = 'auto';
      ctx.scheduleSave();
      ctx.render();
      return;
    }

    // / in word column draft: open word search overlay
    if (e.key === '/' && !isTextCol && contextTextId) {
      e.preventDefault();
      openWordSearch(contextTextId, ctx);
      return;
    }

    if (e.key === 'ArrowDown') {
      const onLastLine = !draftInput.value
        .slice(draftInput.selectionStart ?? draftInput.value.length)
        .includes('\n');
      if (!onLastLine) return;
      e.preventDefault();
      const colInputs = Array.from(
        ctx.outer.querySelectorAll<HTMLTextAreaElement>(
          `[data-nav-input][data-column-index="${colIndex}"]`,
        ),
      ).filter((inp) => inp.offsetParent !== null);
      const pos = colInputs.indexOf(draftInput);
      if (pos < colInputs.length - 1) colInputs[pos + 1].focus({ preventScroll: true });
    }
  });

  draftRow.appendChild(draftMarker);
  draftRow.appendChild(draftInput);
  col.appendChild(draftRow);

  // Item rows
  for (const item of items) {
    const isInPath = state.path[colIndex] === item.id;
    const isProposed = (item as { status?: string }).status === 'proposed';
    const isIssue =
      (item as { type?: string }).type === 'issue' || item.text.startsWith('?');

    const row = document.createElement('div');
    row.dataset.nodeRow = item.id;
    row.dataset.inPath = isInPath ? 'true' : 'false';
    row.style.display = 'flex';
    row.style.alignItems = 'flex-start';
    row.style.gap = '4px';
    row.style.padding = '1px 8px 1px 12px';
    row.style.background = isInPath ? theme.selectSubtle : 'transparent';

    const cacheKey = `${colIndex}:${item.id}`;
    let inp = state.inputCache.get(cacheKey);
    if (!inp) {
      inp = createInput(item, colIndex, contextTextId, ctx);
      state.inputCache.set(cacheKey, inp);
    }
    if (inp.value !== item.text) inp.value = item.text;
    inp.dataset.columnIndex = String(colIndex);
    inp.style.background = isIssue ? theme.issueBg : isProposed ? theme.proposedBg : 'transparent';
    inp.style.color = isIssue ? theme.issueText : isProposed ? theme.proposedText : 'inherit';
    inp.style.fontStyle = isProposed ? 'italic' : 'normal';
    inp.style.borderRadius = isIssue || isProposed ? '3px' : '0';

    const markerColor = isIssue
      ? theme.issueMarkerBright
      : isProposed
      ? theme.proposedMarkerBright
      : theme.markerDefault;
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
        color: isIssue
          ? theme.issueAccent
          : isProposed
          ? theme.proposedAccent
          : theme.textFaint,
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

  // Column 0: all texts
  wrapper.appendChild(buildColumn(state.texts, 0, null, ctx));

  // Additional columns driven by path
  for (let i = 0; i < state.path.length; i++) {
    const colIndex = i + 1;
    const isTextCol = isTextColumn(colIndex);
    const ctxTextId = !isTextCol ? state.path[i] : null;
    const items = getColumnItems(state.texts, state.words, state.path, colIndex);
    wrapper.appendChild(buildColumn(items, colIndex, ctxTextId, ctx));
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
    breadcrumb.appendChild(makeCrumb(entity.text, i === state.path.length - 1));
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
