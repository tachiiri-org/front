import type { GraphText, GraphWord } from '../../../../schema/component/kind/word-graph';
import type { WordGraphContext } from './types';
import { randomId, findText, findWord, isTextColumn } from './ops';
import { createKeydownHandler } from './keyboard';

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
      const newPath = [...state.path.slice(0, colIndex), item.id];
      const pathChanged = JSON.stringify(newPath) !== JSON.stringify(state.path);
      state.focusedId = item.id;
      state.focusedColumn = colIndex;
      state.path = newPath;
      state.pendingFocusId = item.id;
      state.pendingFocusColumn = colIndex;
      if (pathChanged) ctx.scheduleRender();
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
