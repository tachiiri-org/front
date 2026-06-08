import type { GraphWord } from '../../../../schema/component/kind/word-graph';
import type { WordGraphContext } from './types';
import { randomId, findText, getLangText, setLangText, findWordByText, wordMatchesQuery } from './ops';
import { theme } from '../theme';

export const openWordLink = (textId: string, ctx: WordGraphContext): void => {
  const { state } = ctx;

  ctx.outer.querySelector('[data-word-link-overlay]')?.remove();

  const overlay = document.createElement('div');
  overlay.dataset.wordLinkOverlay = 'true';
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
    width: '260px',
    maxHeight: '320px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  });

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = '単語を検索または作成...';
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
  list.style.flex = '1';

  let matches: GraphWord[] = [];
  let selectedIdx = -1;

  const highlight = () => {
    Array.from(list.children).forEach((child, i) => {
      (child as HTMLElement).style.background = i === selectedIdx ? theme.selectSubtle : 'transparent';
    });
  };

  const doLink = (word: GraphWord) => {
    const text = findText(state.texts, textId);
    if (text && !text.wordIds.includes(word.id)) {
      ctx.pushHistory();
      text.wordIds.push(word.id);
      ctx.scheduleSave();
      ctx.render();
    }
    overlay.remove();
  };

  const doCreate = (wordText: string) => {
    const existing = findWordByText(state.words, wordText);
    const word = existing ?? (() => {
      const w: GraphWord = { id: randomId() };
      setLangText(w, state.lang, wordText);
      return w;
    })();
    ctx.pushHistory();
    if (!existing) state.words.push(word);
    const text = findText(state.texts, textId);
    if (text && !text.wordIds.includes(word.id)) text.wordIds.push(word.id);
    ctx.scheduleSave();
    ctx.render();
    overlay.remove();
  };

  const update = () => {
    const q = searchInput.value.toLowerCase().trim();
    matches = state.words.filter(w => q === '' || wordMatchesQuery(w, q));
    selectedIdx = -1;

    const rows: HTMLElement[] = matches.map(w => {
      const row = document.createElement('div');
      row.textContent = getLangText(w, state.lang);
      Object.assign(row.style, { padding: '3px 10px', cursor: 'pointer', color: theme.textHigh, fontSize: 'inherit' });
      row.addEventListener('mouseenter', () => { selectedIdx = matches.indexOf(w); highlight(); });
      row.addEventListener('mouseleave', () => { selectedIdx = -1; highlight(); });
      row.addEventListener('click', () => doLink(w));
      return row;
    });

    const q2 = searchInput.value.trim();
    if (q2 && !findWordByText(state.words, q2)) {
      const createRow = document.createElement('div');
      createRow.textContent = `+ "${q2}" として登録`;
      Object.assign(createRow.style, { padding: '3px 10px', cursor: 'pointer', color: theme.textFaint, fontStyle: 'italic', fontSize: 'inherit' });
      createRow.addEventListener('mouseenter', () => { selectedIdx = matches.length; highlight(); createRow.style.background = theme.selectSubtle; });
      createRow.addEventListener('mouseleave', () => { selectedIdx = -1; highlight(); createRow.style.background = 'transparent'; });
      createRow.addEventListener('click', () => doCreate(q2));
      rows.push(createRow);
    }

    list.replaceChildren(...rows);
    highlight();
  };

  searchInput.addEventListener('input', update);

  searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') { overlay.remove(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, list.children.length - 1);
      highlight();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, -1);
      highlight();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = searchInput.value.trim();
      if (!q) return;
      if (selectedIdx >= 0 && selectedIdx < matches.length) {
        doLink(matches[selectedIdx]);
      } else if (selectedIdx === matches.length) {
        doCreate(q);
      } else if (matches.length > 0) {
        doLink(matches[0]);
      } else {
        doCreate(q);
      }
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
