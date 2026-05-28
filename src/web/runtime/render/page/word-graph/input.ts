import type { GraphText, GraphWord } from '../../../../schema/component/kind/word-graph';
import type { WordGraphContext } from './types';
import { randomId, findText, findWord, isTextColumn } from './ops';
import { createKeydownHandler } from './keyboard';
import { theme } from '../theme';

export const createInput = (
  item: GraphText | GraphWord,
  colIndex: number,
  contextTextId: string | null,
  ctx: WordGraphContext,
): HTMLTextAreaElement => {
  const { state } = ctx;
  const input = document.createElement('textarea');
  input.rows = 1;
  input.dataset.nodeId = item.id;
  input.dataset.navInput = 'node';
  input.dataset.columnIndex = String(colIndex);
  Object.assign(input.style, {
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
  });
  (input.style as unknown as Record<string, string>)['field-sizing'] = 'content';

  input.addEventListener('focus', () => {
    if (state.focusedId !== item.id || state.focusedColumn !== colIndex) {
      state.focusedId = item.id;
      state.focusedColumn = colIndex;
      if (colIndex < 2) {
        state.pendingFocusId = item.id;
        state.pendingFocusColumn = colIndex;
        // Col0/Col1: extend path and re-render only when path changes
        const newPath = [...state.path.slice(0, colIndex), item.id];
        const pathChanged = JSON.stringify(newPath) !== JSON.stringify(state.path);
        state.path = newPath;
        if (pathChanged) ctx.scheduleRender();
      } else {
        // Col2 (last column): update visuals directly without DOM rebuild.
        // scheduleRender causes outer.replaceChildren() which removes the focused
        // element mid-event, requiring a double-click to re-focus.

        // 1. Un-highlight all col3 item rows via their textarea's data-column-index
        ctx.outer.querySelectorAll<HTMLTextAreaElement>(
          `[data-nav-input="node"][data-column-index="${colIndex}"]`,
        ).forEach(inp => {
          const row = inp.closest<HTMLElement>('[data-node-row]');
          if (row) row.style.background = 'transparent';
        });
        // 2. Highlight the clicked row
        const curRow = input.closest<HTMLElement>('[data-node-row]');
        if (curRow) curRow.style.background = theme.selectSubtle;

        // 3. Dim col2 words not linked to this col3 text
        const text = isTextColumn(colIndex) ? findText(state.texts, item.id) : undefined;
        const wordIds = new Set(text?.wordIds ?? []);
        const col1Div = ctx.outer.querySelector<HTMLElement>('[data-col-index="1"]');
        if (col1Div) {
          col1Div.querySelectorAll<HTMLElement>('[data-node-row]').forEach(row => {
            const wid = row.dataset.nodeRow;
            row.style.opacity = (!wid || wordIds.has(wid)) ? '1' : '0.35';
          });
        }
      }
    }
  });

  input.addEventListener('input', () => {
    if (!CSS.supports('field-sizing', 'content')) {
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
    }

    if (isTextColumn(colIndex)) {
      const text = findText(state.texts, item.id);
      if (text) text.text = input.value;
    } else {
      const word = findWord(state.words, item.id);
      if (word) word.text = input.value;
    }
    ctx.scheduleSave();
  });

  input.addEventListener('keydown', createKeydownHandler(item, colIndex, contextTextId, input, ctx));

  return input;
};
