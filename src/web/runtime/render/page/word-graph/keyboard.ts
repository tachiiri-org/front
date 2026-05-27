import type { GraphText, GraphWord } from '../../../../schema/component/kind/word-graph';
import type { WordGraphContext } from './types';
import { randomId, findText, isTextColumn, getColumnItemIds } from './ops';
import { openWordLink } from './word-link-overlay';

const getColInputs = (outer: HTMLElement, colIndex: number): HTMLTextAreaElement[] => {
  const graphId = outer.dataset.graphId;
  if (graphId) {
    return Array.from(
      document.querySelectorAll<HTMLTextAreaElement>(
        `[data-graph-id="${CSS.escape(graphId)}"] [data-nav-input][data-column-index="${colIndex}"]`,
      ),
    ).filter((inp) => inp.offsetParent !== null);
  }
  return Array.from(
    outer.querySelectorAll<HTMLTextAreaElement>(
      `[data-nav-input][data-column-index="${colIndex}"]`,
    ),
  ).filter((inp) => inp.offsetParent !== null);
};

export const createKeydownHandler = (
  item: GraphText | GraphWord,
  colIndex: number,
  contextTextId: string | null,
  input: HTMLTextAreaElement,
  ctx: WordGraphContext,
): ((e: KeyboardEvent) => void) => {
  return (e: KeyboardEvent) => {
    const { state } = ctx;
    const isTextCol = isTextColumn(colIndex);

    // Ctrl+Z: undo
    if (e.key === 'z' && e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (state.history.length > 0) {
        const prev = state.history.pop()!;
        state.texts = prev.texts;
        state.words = prev.words;
        ctx.scheduleSave();
        ctx.render();
      }
      return;
    }

    // Ctrl+Enter: accept (remove "proposed" word link)
    if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (!isTextCol) return;
      ctx.pushHistory();
      const text = state.texts.find((t) => t.id === item.id);
      if (text) {
        const proposedWord = state.words.find((w) => w.text === 'proposed');
        if (proposedWord) text.wordIds = text.wordIds.filter((id) => id !== proposedWord.id);
        ctx.scheduleSave();
        ctx.render();
      }
      return;
    }

    // Ctrl+?: toggle "issue" word link
    if (e.key === '?' && e.ctrlKey) {
      e.preventDefault();
      if (!isTextCol) return;
      ctx.pushHistory();
      const text = state.texts.find((t) => t.id === item.id);
      if (text) {
        let issueWord = state.words.find((w) => w.text === 'issue');
        if (!issueWord) { issueWord = { id: randomId(), text: 'issue' }; state.words.push(issueWord); }
        if (text.wordIds.includes(issueWord.id)) {
          text.wordIds = text.wordIds.filter((id) => id !== issueWord!.id);
        } else {
          text.wordIds.push(issueWord.id);
        }
        ctx.scheduleSave();
        ctx.render();
      }
      return;
    }

    // Ctrl+Shift+Backspace: delete or unlink
    if (e.key === 'Backspace' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      ctx.pushHistory();
      const colIds = getColumnItemIds(state.texts, state.words, state.path, colIndex);
      const idx = colIds.indexOf(item.id);
      const prevId = idx > 0 ? colIds[idx - 1] : (colIds.length > 1 ? colIds[1] : null);

      if (colIndex === 0) {
        // Delete text entirely
        state.texts = state.texts.filter((t) => t.id !== item.id);
        if (state.path[0] === item.id) state.path = [];
      } else if (!isTextCol) {
        // Delete word entirely from global words list and all texts
        state.words = state.words.filter((w) => w.id !== item.id);
        for (const t of state.texts) {
          t.wordIds = t.wordIds.filter((id) => id !== item.id);
        }
        const pathIdx = state.path.indexOf(item.id);
        if (pathIdx >= 0) state.path = state.path.slice(0, pathIdx);
      } else {
        // Text column > 0: unlink context word from this text
        const contextWordId = state.path[colIndex - 1];
        const text = findText(state.texts, item.id);
        if (text && contextWordId) {
          text.wordIds = text.wordIds.filter((id) => id !== contextWordId);
        }
      }

      state.focusedId = prevId;
      state.focusedColumn = prevId !== null ? colIndex : null;
      state.pendingFocusId = prevId;
      state.pendingFocusColumn = prevId !== null ? colIndex : null;
      ctx.scheduleSave();
      ctx.render();
      return;
    }

    // Backspace at start of text node: merge with previous node
    if (e.key === 'Backspace' && isTextCol && !e.ctrlKey && !e.shiftKey &&
        (input.selectionStart ?? 0) === 0 && (input.selectionEnd ?? 0) === 0) {
      const colIds = getColumnItemIds(state.texts, state.words, state.path, colIndex);
      const idx = colIds.indexOf(item.id);
      if (idx > 0) {
        e.preventDefault();
        ctx.pushHistory();
        const prevId = colIds[idx - 1];
        const prevText = findText(state.texts, prevId);
        const currText = findText(state.texts, item.id);
        if (prevText && currText) {
          const mergePos = prevText.text.length;
          prevText.text = prevText.text + currText.text;
          state.texts = state.texts.filter((t) => t.id !== item.id);
          if (state.path[colIndex] === item.id) {
            state.path = [...state.path.slice(0, colIndex), prevId];
          }
          state.pendingFocusId = prevId;
          state.pendingFocusColumn = colIndex;
          state.pendingFocusCursorPos = mergePos;
          ctx.scheduleSave();
          ctx.render();
        }
        return;
      }
      if (input.value !== '') return;
    }

    // Backspace on empty input: delete / unlink (same as Ctrl+Shift+Backspace)
    if (e.key === 'Backspace' && input.value === '') {
      e.preventDefault();
      ctx.pushHistory();
      const colIds = getColumnItemIds(state.texts, state.words, state.path, colIndex);
      const idx = colIds.indexOf(item.id);
      const prevId = idx > 0 ? colIds[idx - 1] : (colIds.length > 1 ? colIds[1] : null);

      if (colIndex === 0) {
        state.texts = state.texts.filter((t) => t.id !== item.id);
        if (state.path[0] === item.id) state.path = [];
      } else if (!isTextCol) {
        state.words = state.words.filter((w) => w.id !== item.id);
        for (const t of state.texts) {
          t.wordIds = t.wordIds.filter((id) => id !== item.id);
        }
        const pathIdx = state.path.indexOf(item.id);
        if (pathIdx >= 0) state.path = state.path.slice(0, pathIdx);
      } else {
        const contextWordId = state.path[colIndex - 1];
        const text = findText(state.texts, item.id);
        if (text && contextWordId) {
          text.wordIds = text.wordIds.filter((id) => id !== contextWordId);
        }
      }

      state.focusedId = prevId;
      state.focusedColumn = prevId !== null ? colIndex : null;
      state.pendingFocusId = prevId;
      state.pendingFocusColumn = prevId !== null ? colIndex : null;
      ctx.scheduleSave();
      ctx.render();
      return;
    }

    // @ in text column: open word link overlay
    if (e.key === '@' && isTextCol) {
      e.preventDefault();
      openWordLink(item.id, ctx);
      return;
    }

    // Tab in text column with selection: extract selected text as word
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && isTextCol) {
      const selStart = input.selectionStart ?? 0;
      const selEnd = input.selectionEnd ?? 0;
      if (selStart !== selEnd) {
        e.preventDefault();
        const selectedText = input.value.slice(selStart, selEnd).trim();
        if (selectedText) {
          ctx.pushHistory();
          const existing = state.words.find(w => w.text === selectedText);
          const newWord: GraphWord = existing ?? { id: randomId(), text: selectedText };
          if (!existing) state.words.push(newWord);
          const text = findText(state.texts, item.id);
          if (text && !text.wordIds.includes(newWord.id)) {
            text.wordIds.push(newWord.id);
          }
          state.path = [...state.path.slice(0, colIndex), item.id];
          state.pendingFocusId = newWord.id;
          state.pendingFocusColumn = colIndex + 1;
          ctx.scheduleSave();
          ctx.render();
        }
        return;
      }
    }

    // Enter: create new item after current
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      ctx.pushHistory();

      if (isTextCol) {
        const cursorPos = input.selectionStart ?? input.value.length;
        const before = input.value.slice(0, cursorPos);
        const after = input.value.slice(cursorPos);

        const currentText = state.texts.find((t) => t.id === item.id);
        if (currentText) currentText.text = before;

        const newText: GraphText = { id: randomId(), text: after, wordIds: [] };
        if (colIndex > 0) {
          // Auto-link to context word so it appears in this column
          const contextWordId = state.path[colIndex - 1];
          if (contextWordId) newText.wordIds.push(contextWordId);
        }
        const idx = state.texts.findIndex((t) => t.id === item.id);
        state.texts.splice(idx + 1, 0, newText);
        state.path = [...state.path.slice(0, colIndex), newText.id];
        state.pendingFocusId = newText.id;
        state.pendingFocusColumn = colIndex;
      } else {
        if (!contextTextId) return;
        const newWord: GraphWord = { id: randomId(), text: '' };
        state.words.push(newWord);
        const contextText = findText(state.texts, contextTextId);
        if (contextText) {
          const idx = contextText.wordIds.indexOf(item.id);
          if (idx >= 0) contextText.wordIds.splice(idx + 1, 0, newWord.id);
          else contextText.wordIds.push(newWord.id);
        }
        state.pendingFocusId = newWord.id;
        state.pendingFocusColumn = colIndex;
      }

      ctx.scheduleSave();
      ctx.render();
      return;
    }

    // Ctrl+Shift+↑: reorder up
    if (e.key === 'ArrowUp' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      ctx.pushHistory();
      if (!isTextCol) {
        const idx = state.words.findIndex((w) => w.id === item.id);
        if (idx > 0) {
          [state.words[idx - 1], state.words[idx]] = [state.words[idx], state.words[idx - 1]];
          ctx.scheduleSave();
          ctx.render();
          requestAnimationFrame(() => input.focus({ preventScroll: true }));
        }
      } else {
        const idx = state.texts.findIndex((t) => t.id === item.id);
        if (idx > 0) {
          [state.texts[idx - 1], state.texts[idx]] = [state.texts[idx], state.texts[idx - 1]];
          state.pendingFocusId = item.id;
          state.pendingFocusColumn = colIndex;
          ctx.scheduleSave();
          ctx.render();
        }
      }
      return;
    }

    // Ctrl+Shift+↓: reorder down
    if (e.key === 'ArrowDown' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      ctx.pushHistory();
      if (!isTextCol) {
        const idx = state.words.findIndex((w) => w.id === item.id);
        if (idx < state.words.length - 1) {
          [state.words[idx], state.words[idx + 1]] = [state.words[idx + 1], state.words[idx]];
          ctx.scheduleSave();
          ctx.render();
          requestAnimationFrame(() => input.focus({ preventScroll: true }));
        }
      } else {
        const idx = state.texts.findIndex((t) => t.id === item.id);
        if (idx < state.texts.length - 1) {
          [state.texts[idx], state.texts[idx + 1]] = [state.texts[idx + 1], state.texts[idx]];
          state.pendingFocusId = item.id;
          state.pendingFocusColumn = colIndex;
          ctx.scheduleSave();
          ctx.render();
        }
      }
      return;
    }

    // ArrowRight: navigate to next column (at end of input)
    if (
      e.key === 'ArrowRight' &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey &&
      input.selectionStart === input.value.length &&
      input.selectionEnd === input.value.length
    ) {
      e.preventDefault();
      state.path = [...state.path.slice(0, colIndex), item.id];
      ctx.render();
      requestAnimationFrame(() => {
        const colInputs = getColInputs(ctx.outer, colIndex + 1);
        if (colInputs.length > 0) colInputs[0].focus({ preventScroll: true });
      });
      return;
    }

    // ArrowLeft: navigate to previous column (at start of input)
    if (
      e.key === 'ArrowLeft' &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey &&
      input.selectionStart === 0 &&
      input.selectionEnd === 0
    ) {
      if (colIndex === 0) return;
      e.preventDefault();
      const prevId = state.path[colIndex - 1];
      if (prevId) {
        state.pendingFocusId = prevId;
        state.pendingFocusColumn = colIndex - 1;
        ctx.render();
      }
      return;
    }

    // ArrowUp: navigate up in column
    if (e.key === 'ArrowUp' && !e.ctrlKey && !e.shiftKey) {
      const onFirstLine = !input.value.slice(0, input.selectionStart ?? 0).includes('\n');
      if (!onFirstLine) return;
      e.preventDefault();
      const colInputs = getColInputs(ctx.outer, colIndex);
      const pos = colInputs.indexOf(input);
      if (pos > 0) colInputs[pos - 1].focus({ preventScroll: true });
      return;
    }

    // ArrowDown: navigate down in column
    if (e.key === 'ArrowDown' && !e.ctrlKey && !e.shiftKey) {
      const onLastLine = !input.value
        .slice(input.selectionStart ?? input.value.length)
        .includes('\n');
      if (!onLastLine) return;
      e.preventDefault();
      const colInputs = getColInputs(ctx.outer, colIndex);
      const pos = colInputs.indexOf(input);
      if (pos < colInputs.length - 1) colInputs[pos + 1].focus({ preventScroll: true });
      return;
    }
  };
};
