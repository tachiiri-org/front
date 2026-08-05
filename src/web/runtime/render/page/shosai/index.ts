// ショサイ（書斎）のカスタム画面。TS で DOM を直接構築する SPA。
//
// 全体構成はグラフエディタの多ペインに合わせ、左=データベース／ページ一覧、
// 中央=データベース（テーブルビュー）、右=ブロックエディタ の3ペインとする。
// API は front worker 経由で backend /api/v1/shosai/* に proxy される。

import * as api from './api';
import { SHOSAI_CSS, el } from './style';
import { createEditorView } from './editor-view';
import { createDatabaseView } from './database-view';
import { createNotionView, notionReturnMessage } from './notion-view';

export async function renderShosai(container: HTMLElement): Promise<void> {
  container.innerHTML = '';
  const style = el('style');
  style.textContent = SHOSAI_CSS;
  container.append(style);

  const wrap = el('div', { class: 's-wrap' });
  container.append(wrap);

  // ── エラー表示 ───────────────────────────────────────────────
  // 失敗を握り潰すと「保存したつもりで消えている」が起きるので、必ず画面に出す。
  const errBar = el('div', { class: 's-err' });
  errBar.style.display = 'none';
  const showError = (message: string): void => {
    errBar.textContent = message.includes('unauthenticated')
      ? 'ログインの有効期限が切れました。再読み込みしてログインし直してください。'
      : `エラー: ${message}`;
    errBar.style.display = '';
  };
  container.insertBefore(errBar, wrap);

  // Notion のコールバックから戻ったときの結果表示。URL に痕跡を残さない。
  const back = notionReturnMessage();
  if (back) {
    const bar = el('div', { class: back.ok ? 's-notion-progress' : 's-err' });
    bar.textContent = back.text;
    container.insertBefore(bar, wrap);
    history.replaceState(null, '', location.pathname);
    if (back.ok) setTimeout(() => bar.remove(), 6000);
  }

  // ── 左ペイン ─────────────────────────────────────────────────
  const side = el('div', { class: 's-side' });
  const sideList = el('div', { class: 's-side-list' });

  const searchBox = el('div', { class: 's-side-head' });
  const searchInput = el('input', { class: 's-search', placeholder: '全文検索' }) as HTMLInputElement;
  searchBox.append(searchInput);

  side.append(searchBox, sideList);

  // ── 中央・右ペイン ───────────────────────────────────────────
  const editor = createEditorView({
    onError: showError,
    onTitleChange: () => { void refreshSide(); },
  });
  const database = createDatabaseView({
    onError: showError,
    onOpenPage: (blockId) => { void editor.open(blockId); },
    onChanged: () => { void refreshSide(); },
  });

  const notion = createNotionView({
    onError: showError,
    // 取り込み中も一覧を更新する。行が増えていくのが見えるようにする。
    onImported: () => { void refreshSide(); },
  });

  wrap.append(side, database.el, editor.el);

  // ── 一覧の描画 ───────────────────────────────────────────────
  let activeDatabaseId: string | null = null;
  let activePageId: string | null = null;

  const sectionHead = (label: string, onAdd?: () => void): HTMLElement => {
    const h = el('div', { class: 's-side-head' });
    h.append(el('span', { text: label }), el('span', { class: 's-side-head-sp' }));
    if (onAdd) {
      const b = el('button', { class: 's-col-add-btn', text: '＋' });
      b.addEventListener('click', onAdd);
      h.append(b);
    }
    return h;
  };

  async function refreshSide(): Promise<void> {
    sideList.innerHTML = '';
    try {
      const [dbs, pages] = await Promise.all([api.listDatabases(), api.listPages()]);

      sideList.append(sectionHead('データベース', () => {
        const title = prompt('データベースの名前');
        if (title === null) return;
        void (async () => {
          try {
            const created = await api.createDatabase({ title: title || '無題のデータベース' });
            activeDatabaseId = created.databaseId;
            await database.open(created.databaseId);
            await refreshSide();
          } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
        })();
      }));

      if (!dbs.databases.length) {
        sideList.append(el('div', { class: 's-empty', text: 'まだありません' }));
      }
      for (const d of dbs.databases) {
        const item = el('div', { class: `s-item${d.databaseId === activeDatabaseId ? ' on' : ''}` });
        item.append(
          el('span', { class: 's-item-ic', text: '▦' }),
          el('span', { class: 's-item-tx', text: d.title || '無題のデータベース' }),
          el('span', { class: 's-item-ct', text: String(d.rowCount) }),
        );
        item.addEventListener('click', () => {
          activeDatabaseId = d.databaseId;
          void database.open(d.databaseId).then(refreshSide);
        });
        sideList.append(item);
      }

      const pageSec = el('div', { class: 's-side-sec' });
      pageSec.append(sectionHead('ページ', () => {
        void (async () => {
          try {
            const created = await api.createBlock({ type: 'page', text: '無題' });
            activePageId = created.id;
            await editor.open(created.id);
            await refreshSide();
          } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
        })();
      }));
      sideList.append(pageSec);

      if (!pages.pages.length) {
        sideList.append(el('div', { class: 's-empty', text: 'まだありません' }));
      }
      for (const p of pages.pages) {
        const item = el('div', { class: `s-item${p.id === activePageId ? ' on' : ''}` });
        item.append(
          el('span', { class: 's-item-ic', text: '▤' }),
          el('span', { class: 's-item-tx', text: p.title || '無題' }),
        );
        item.addEventListener('click', () => {
          activePageId = p.id;
          void editor.open(p.id).then(refreshSide);
        });
        sideList.append(item);
      }

      // Notion 連携は一覧の下。接続とデータソース選択はここから。
      sideList.append(notion.el);
      void notion.refresh();
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── 検索 ─────────────────────────────────────────────────────
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    searchTimer = setTimeout(() => {
      if (q === '') { void refreshSide(); return; }
      void (async () => {
        try {
          const hits = await api.search(q);
          sideList.innerHTML = '';
          sideList.append(sectionHead(`検索結果 (${hits.results.length})`));
          if (!hits.results.length) {
            sideList.append(el('div', { class: 's-empty', text: '見つかりませんでした' }));
          }
          for (const h of hits.results) {
            const item = el('div', { class: 's-item' });
            item.append(
              el('span', { class: 's-item-ic', text: h.type === 'page' ? '▤' : '·' }),
              el('span', { class: 's-item-tx', text: h.text.slice(0, 60) || '（空）' }),
            );
            // ヒットしたのがページ本体ならそのまま開ける。中のブロックは親を辿る API がまだない。
            if (h.type === 'page') {
              item.addEventListener('click', () => { activePageId = h.id; void editor.open(h.id); });
            } else {
              item.title = 'ページ内のブロック（親を辿る API は未実装）';
            }
            sideList.append(item);
          }
        } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
      })();
    }, 250);
  });

  await refreshSide();
}
