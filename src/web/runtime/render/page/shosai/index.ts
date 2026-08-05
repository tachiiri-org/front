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
  // 一覧（データベース／ページ）と NOTION セクションを分ける。混ぜると取り込み中の
  // 更新で NOTION セクションまで作り直され、接続名やボタンが点滅する。
  const listBox = el('div');
  const notionBox = el('div');
  sideList.append(listBox, notionBox);
  // 引き下げて更新（モバイル）。
  const ptr = el('div', { class: 's-ptr', text: '引き下げて更新' });
  sideList.insertBefore(ptr, listBox);

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
    // 完了時だけ全体を描き直す。
    onImported: () => { void refreshSide(); },
    // 取り込み中は中央ペインだけを静かに更新する。左ペインは触らない。
    onProgress: (databaseId) => {
      if (activeDatabaseId === databaseId) void database.reload();
    },
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
    listBox.innerHTML = '';
    try {
      const [dbs, pages] = await Promise.all([api.listDatabases(), api.listPages()]);

      listBox.append(sectionHead('データベース', () => {
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
        listBox.append(el('div', { class: 's-empty', text: 'まだありません' }));
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
        listBox.append(item);
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
      listBox.append(pageSec);

      if (!pages.pages.length) {
        listBox.append(el('div', { class: 's-empty', text: 'まだありません' }));
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
        listBox.append(item);
      }

      // NOTION セクションは作り直さない。初回だけ組み立てる。
      if (!notionBox.contains(notion.el)) {
        notionBox.append(notion.el);
        void notion.refresh();
      }
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
          listBox.innerHTML = '';
          listBox.append(sectionHead(`検索結果 (${hits.results.length})`));
          if (!hits.results.length) {
            listBox.append(el('div', { class: 's-empty', text: '見つかりませんでした' }));
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
            listBox.append(item);
          }
        } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
      })();
    }, 250);
  });

  // ── モバイル: 固定フッターで3ペインを切り替える ────────────────
  // ウラナイと同型。data-pane で表示するペインを決める。
  const PANES: Array<{ key: string; label: string }> = [
    { key: 'side', label: '一覧' },
    { key: 'main', label: 'データベース' },
    { key: 'editor', label: 'エディタ' },
  ];
  const foot = el('div', { class: 's-foot' });
  const footBtns: HTMLElement[] = [];
  const setPane = (key: string): void => {
    wrap.dataset.pane = key;
    footBtns.forEach((b, i) => b.classList.toggle('on', PANES[i].key === key));
  };
  for (const p of PANES) {
    const b = el('button', { class: 's-foot-btn', type: 'button', text: p.label });
    b.addEventListener('click', () => setPane(p.key));
    footBtns.push(b);
    foot.append(b);
  }
  container.append(foot);
  setPane('side');

  // 一覧からデータベース／ページを開いたら、モバイルではそのペインへ移る。
  // 選んだのに画面が変わらないと、反応していないように見える。
  const isNarrow = (): boolean => window.matchMedia('(max-width: 640px)').matches;
  sideList.addEventListener('click', (e) => {
    if (!isNarrow()) return;
    const t = e.target as HTMLElement;
    if (!t.closest('.s-item') || t.closest('.s-notion-connect')) return;
    // データベースかページかは activeDatabaseId / activePageId の更新後に判断できないので、
    // クリックされた項目のアイコンで見分ける。
    const ic = t.closest('.s-item')?.querySelector('.s-item-ic')?.textContent ?? '';
    if (ic === '▦') setPane('main');
    else if (ic === '▤') setPane('editor');
  });

  // ── 引き下げて更新 ────────────────────────────────────────────
  // 左ペインを最上部で下へ引くと再読み込みする。モバイルのブラウザ標準の
  // pull-to-refresh はページ全体を捨てるので、ここは自前で受ける。
  let startY = 0;
  let pulling = false;
  sideList.addEventListener('touchstart', (e) => {
    pulling = sideList.scrollTop <= 0;
    startY = (e as TouchEvent).touches[0].clientY;
  }, { passive: true });
  sideList.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const dy = (e as TouchEvent).touches[0].clientY - startY;
    if (dy <= 0) { ptr.classList.remove('on', 'armed'); return; }
    ptr.classList.add('on');
    ptr.classList.toggle('armed', dy > 64);
    ptr.textContent = dy > 64 ? '離すと更新します' : '引き下げて更新';
  }, { passive: true });
  sideList.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    const armed = ptr.classList.contains('armed');
    ptr.classList.remove('on', 'armed');
    if (!armed) return;
    void (async () => {
      await refreshSide();
      await notion.refresh();
      if (activeDatabaseId) await database.reload();
      if (editor.currentPageId()) await editor.reload();
    })();
  }, { passive: true });

  await refreshSide();
}
