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
  let errTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 出すのは「人が何かできる」ものだけにする。
   * "Failed to fetch"（通信断・取り込み中のリクエスト取りこぼしなど）を出しても
   * 読んだ人にできることが無く、壊れている印象だけが残る。そういうものは
   * コンソールに残して画面には出さない。
   */
  const showError = (message: string): void => {
    if (/unauthenticated|401/.test(message)) {
      errBar.textContent = 'ログインの有効期限が切れました。画面を再読み込みしてログインし直してください。';
    } else if (/insufficient role|403|forbidden/i.test(message)) {
      errBar.textContent = 'この操作の権限がありません。管理者に確認してください。';
    } else if (/Failed to fetch|NetworkError|load failed/i.test(message)) {
      // 通信が一時的に切れただけ。次の操作か自動更新で回復する。
      console.warn('[shosai] 一時的な通信エラー:', message);
      return;
    } else {
      errBar.textContent = `エラー: ${message}`;
    }
    errBar.style.display = '';
    // 出しっぱなしにすると、直った後も壊れているように見える。
    if (errTimer) clearTimeout(errTimer);
    errTimer = setTimeout(() => { errBar.style.display = 'none'; }, 12000);
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


  const searchBox = el('div', { class: 's-side-head' });
  const searchInput = el('input', { class: 's-search', placeholder: '全文検索' }) as HTMLInputElement;
  searchBox.append(searchInput);

  side.append(searchBox, sideList);

  // ── 中央・右ペイン ───────────────────────────────────────────
  const editor = createEditorView({
    onError: showError,
    onTitleChange: () => { void refreshSide(); },
  });
  // 「開く」やリレーションのリンクからエディタへ移る。移らないと、モバイルでは
  // 読み込まれてもエディタペインが隠れたままで、中身が無いように見える。
  let goEditor: (() => void) | null = null;
  const database = createDatabaseView({
    onError: showError,
    onOpenPage: (blockId) => {
      activePageId = blockId;
      void editor.open(blockId).then(() => { goEditor?.(); void refreshSide(); });
    },
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
  const isNarrowNow = (): boolean => window.matchMedia('(max-width: 640px)').matches;
  const PANES: Array<{ key: string; label: string }> = [
    { key: 'side', label: '一覧' },
    { key: 'main', label: 'データベース' },
    { key: 'editor', label: 'エディタ' },
  ];
  const foot = el('div', { class: 's-foot' });
  // 幅が広いときは3ペインとも見えているので、切り替えではなくエディタへスクロールする。
  const footBtns: HTMLElement[] = [];
  const setPane = (key: string): void => {
    wrap.dataset.pane = key;
    footBtns.forEach((b, i) => b.classList.toggle('on', PANES[i].key === key));
  };
  for (const p of PANES) {
    const b = el('button', { class: 's-foot-btn', type: 'button', text: p.label });
    b.addEventListener('click', () => goPane(p.key));
    footBtns.push(b);
    foot.append(b);
  }
  container.append(foot);

  // モバイルの「戻る」でブラウザごと閉じないようにする。ペインの移動を履歴に積み、
  // 戻る操作は前のペインへ返す。積まないと、最初の画面で戻る＝離脱になってしまう。
  let poppingPane = false;
  const goPane = (key: string, push = true): void => {
    if (wrap.dataset.pane === key) return;
    setPane(key);
    if (push && !poppingPane) history.pushState({ shosaiPane: key }, '', location.pathname);
  };
  window.addEventListener('popstate', (e) => {
    // ポップオーバー（選択肢・参照先・取り込み）が開いていれば、まずそれを閉じる。
    // 開いたまま画面が切り替わると、何が起きたのか分からなくなる。
    const overlays = document.querySelectorAll('.s-overlay, .s-pop');
    if (overlays.length) {
      overlays.forEach((n) => n.remove());
      history.pushState({ shosaiPane: wrap.dataset.pane ?? 'side' }, '', location.pathname);
      return;
    }
    const st = (e.state ?? null) as { shosaiPane?: string } | null;
    poppingPane = true;
    // 履歴に積んだペインが無ければ一覧へ戻す（最初の画面）。
    setPane(st?.shosaiPane ?? 'side');
    poppingPane = false;
  });
  setPane('side');
  // 最初の状態も履歴に持たせておく。これが無いと1回目の戻るで離脱する。
  history.replaceState({ shosaiPane: 'side' }, '', location.pathname);
  goEditor = () => {
    if (isNarrowNow()) goPane('editor');
    else editor.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  // 一覧からデータベース／ページを開いたら、モバイルではそのペインへ移る。
  // 選んだのに画面が変わらないと、反応していないように見える。
  const isNarrow = isNarrowNow;
  sideList.addEventListener('click', (e) => {
    if (!isNarrow()) return;
    const t = e.target as HTMLElement;
    if (!t.closest('.s-item') || t.closest('.s-notion-connect')) return;
    // データベースかページかは activeDatabaseId / activePageId の更新後に判断できないので、
    // クリックされた項目のアイコンで見分ける。
    const ic = t.closest('.s-item')?.querySelector('.s-item-ic')?.textContent ?? '';
    if (ic === '▦') goPane('main');
    else if (ic === '▤') goPane('editor');
  });

  // 引き下げて更新はブラウザ標準に任せる（body が document スクロールなら効く）。
  // 自前で touchmove を拾うとネイティブの挙動と二重になり、どちらも中途半端になる。

  await refreshSide();
}
