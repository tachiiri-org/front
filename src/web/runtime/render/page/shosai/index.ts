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
  const toolBox = el('div', { class: 's-side-sec' });
  sideList.append(listBox, notionBox, toolBox);


  const searchBox = el('div', { class: 's-side-head' });
  const searchInput = el('input', { class: 's-search', placeholder: '全文検索' }) as HTMLInputElement;
  searchBox.append(searchInput);

  side.append(searchBox, sideList);

  // ── 中央・右ペイン ───────────────────────────────────────────
  const editor = createEditorView({
    onError: showError,
    onTitleChange: () => { void refreshSide(); },
    onClose: () => closeTabByKey('editor'),
    onOpenLink: (blockId) => {
      activePageId = blockId;
      void editor.open(blockId).then(() => {
        openedPage?.(blockId, editor.currentTitle());
        void refreshSide();
      });
    },
  });
  // 「開く」やリレーションのリンクからエディタへ移る。移らないと、モバイルでは
  // 読み込まれてもエディタペインが隠れたままで、中身が無いように見える。
  // 開いたデータベース／ページをフッターのタブに登録する口。
  // 実体はフッターの組み立てのところで入れる（そこでしか状態を持たないため）。
  let openedDatabase: ((id: string, title: string) => void) | null = null;
  let openedPage: ((id: string, title: string) => void) | null = null;
  let closeTabByKey: (key: 'main' | 'editor') => void = () => { /* フッター組み立て後に入る */ };
  const database = createDatabaseView({
    onError: showError,
    onOpenPage: (blockId) => {
      activePageId = blockId;
      void editor.open(blockId).then(() => {
        openedPage?.(blockId, editor.currentTitle());
        void refreshSide();
      });
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

  /**
   * 一覧の項目を長押ししたときのメニュー。名前の変更と削除。
   * 触っている指の下に出すと隠れるので、画面下から出す（トースト風）。
   */
  const closeSheets = (): void => {
    document.querySelectorAll('.s-sheet, .s-overlay').forEach((n) => n.remove());
  };

  /**
   * 設定。いまはタイムゾーンだけ。相対日付（今週・先月）をどこの時刻で
   * 解くかが変わるので、既定任せにせず選べるようにする。
   */
  const openSettings = async (): Promise<void> => {
    closeSheets();
    let current = 'Asia/Tokyo';
    try {
      const st = await api.readSettings();
      if (st.settings.timezone) current = st.settings.timezone;
    } catch { /* 既定のまま */ }
    const overlay = el('div', { class: 's-overlay' });
    const sheet = el('div', { class: 's-sheet' });
    const close = (): void => { overlay.remove(); sheet.remove(); };
    sheet.append(el('div', { class: 's-sheet-t', text: '設定' }));

    const row = el('div', { class: 's-set-row' });
    row.append(el('span', { class: 's-set-label', text: 'タイムゾーン' }));
    const sel = el('select', { class: 's-filter-sel' }) as HTMLSelectElement;
    // よく使うものだけ並べ、それ以外は現在値として残す。
    const zones = ['Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore',
      'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'UTC'];
    if (!zones.includes(current)) zones.unshift(current);
    for (const z of zones) sel.append(el('option', { value: z, text: z, ...(z === current ? { selected: 'selected' } : {}) }));
    sel.value = current;
    row.append(sel);
    sheet.append(row);
    sheet.append(el('div', {
      class: 's-note',
      text: 'ビューの「今週」「過去1か月」などを、どこの時刻で解くかに使います。',
    }));

    const save = el('button', { class: 's-sheet-item', text: '保存' });
    save.addEventListener('click', () => {
      const next = sel.value;
      close();
      void (async () => {
        try {
          await api.saveSettings({ timezone: next });
          if (activeDatabaseId) await database.reload();
        } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
      })();
    });
    const cancel = el('button', { class: 's-sheet-item s-sheet-cancel', text: 'やめる' });
    cancel.addEventListener('click', close);
    sheet.append(save, cancel);
    overlay.addEventListener('click', close);
    document.body.append(overlay, sheet);
  };

  const openItemMenu = (kind: 'database' | 'page', id: string, title: string): void => {
    closeSheets();   // 前のものが残っていると二重に出る
    const overlay = el('div', { class: 's-overlay' });
    const sheet = el('div', { class: 's-sheet' });
    sheet.append(el('div', { class: 's-sheet-t', text: title || '（無題）' }));
    const close = (): void => { overlay.remove(); sheet.remove(); closeSheets(); };

    const rename = el('button', { class: 's-sheet-item', text: '名前を変更' });
    rename.addEventListener('click', () => {
      close();
      const next = prompt('新しい名前', title);
      if (next === null) return;
      void (async () => {
        try {
          if (kind === 'database') {
            // データベースの名前は、それを表示しているブロックの本文。
            const dbs = await api.listDatabases();
            const target = dbs.databases.find((d) => d.databaseId === id);
            if (target?.blockId) await api.patchBlock(target.blockId, { text: next });
          } else {
            await api.patchBlock(id, { text: next });
          }
          await refreshSide();
          if (kind === 'page' && editor.currentPageId() === id) await editor.reload();
        } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
      })();
    });

    const del = el('button', { class: 's-sheet-item s-sheet-del', text: '削除' });
    del.addEventListener('click', () => {
      close();
      // 取り消せない操作なので、何が消えるかを名指しで確認する。
      const what = kind === 'database' ? 'データベース（中の行ごと）' : 'ページ（中のブロックごと）';
      if (!confirm(`${title || '（無題）'} を削除します。\nこの${what}は元に戻せません。`)) return;
      void (async () => {
        try {
          if (kind === 'database') {
            await api.deleteDatabase(id);
            if (activeDatabaseId === id) closeTabByKey('main');
          } else {
            await api.deleteBlock(id);
            if (activePageId === id) closeTabByKey('editor');
          }
          await refreshSide();
        } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
        finally { closeSheets(); }
      })();
    });

    const cancel = el('button', { class: 's-sheet-item s-sheet-cancel', text: 'やめる' });
    cancel.addEventListener('click', close);
    sheet.append(rename, del, cancel);
    overlay.addEventListener('click', close);
    document.body.append(overlay, sheet);
  };

  /** 長押しを拾う。押したまま 500ms でメニュー、動かしたら取り消し。 */
  const attachLongPress = (node: HTMLElement, run: () => void): void => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let moved = false;
    let fired = false;
    const start = (): void => {
      moved = false; fired = false;
      timer = setTimeout(() => { if (!moved) { fired = true; run(); } }, 500);
    };
    // 長押しの直後に click が続くと、メニューの裏で項目まで開いてしまう。
    node.addEventListener('click', (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
    const cancel = (): void => { if (timer) clearTimeout(timer); timer = null; };
    node.addEventListener('touchstart', start, { passive: true });
    node.addEventListener('touchmove', () => { moved = true; cancel(); }, { passive: true });
    node.addEventListener('touchend', cancel);
    node.addEventListener('touchcancel', cancel);
    // マウスでも同じ操作ができるように、右クリックを同じメニューに割り当てる。
    node.addEventListener('contextmenu', (e) => { e.preventDefault(); run(); });
  };

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
      const dbs = await api.listDatabases();

      // ページの新規作成はデータベース見出しの右に置く。一覧を消しても作れるように。
      listBox.append(sectionHead('データベース', () => {
        const title = prompt('データベースの名前');
        if (title === null) return;
        void (async () => {
          try {
            const created = await api.createDatabase({ title: title || '無題のデータベース' });
            activeDatabaseId = created.databaseId;
            openedDatabase?.(created.databaseId, title || '無題のデータベース');
            await database.open(created.databaseId);
            await refreshSide();
          } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
        })();
      }));

      if (!userDbs.length) {
        listBox.append(el('div', { class: 's-empty', text: 'まだありません' }));
      }
      // 仕組みが持つもの（取り込みログ）は、ユーザーの作ったものと同じ並びに置かない。
      // 下部の「ツール」にまとめる。
      const userDbs = dbs.databases.filter((d) => !d.systemKind);
      const sysDbs = dbs.databases.filter((d) => d.systemKind);
      for (const d of userDbs) {
        // 仕組みが持つもの（取り込みログ）は、ユーザーの作ったものと並べない。
        // 印を変え、消させない。
        const managed = !!d.systemKind;
        const item = el('div', {
          class: `s-item${d.databaseId === activeDatabaseId ? ' on' : ''}${managed ? ' s-item-sys' : ''}`,
        });
        item.append(
          el('span', { class: 's-item-ic', text: managed ? '⚙' : '▦' }),
          el('span', { class: 's-item-tx', text: d.title || '無題のデータベース' }),
          el('span', { class: 's-item-ct', text: String(d.rowCount) }),
        );
        if (managed) item.title = '取り込みの記録です。仕組みが管理しているため削除できません。';
        item.addEventListener('click', () => {
          activeDatabaseId = d.databaseId;
          openedDatabase?.(d.databaseId, d.title || 'データベース');
          void database.open(d.databaseId).then(refreshSide);
        });
        if (!managed) attachLongPress(item, () => openItemMenu('database', d.databaseId, d.title));
        listBox.append(item);
      }

      // ページの一覧は出さない。取り込みで入るページはデータベースの行か、
      // 本文からリンクされたものなので、データベースかリンク、検索から辿れる。
      // 一覧に並べると、リンク先のページが何十件も積み上がって邪魔になる。

      // NOTION セクションは作り直さない。初回だけ組み立てる。
      if (!notionBox.contains(notion.el)) {
        notionBox.append(notion.el);
        void notion.refresh();
      }

      // 一番下に、仕組みのもの（取り込みログ）と設定をまとめる。
      toolBox.innerHTML = '';
      toolBox.append(sectionHead('ツール'));
      for (const d of sysDbs) {
        const item = el('div', { class: `s-item s-item-sys${d.databaseId === activeDatabaseId ? ' on' : ''}` });
        item.append(
          el('span', { class: 's-item-ic', text: '⚙' }),
          el('span', { class: 's-item-tx', text: d.title || '記録' }),
          el('span', { class: 's-item-ct', text: String(d.rowCount) }),
        );
        item.title = '取り込みの記録です。仕組みが管理しているため削除できません。';
        item.addEventListener('click', () => {
          activeDatabaseId = d.databaseId;
          openedDatabase?.(d.databaseId, d.title || '記録');
          void database.open(d.databaseId).then(refreshSide);
        });
        toolBox.append(item);
      }
      const settingItem = el('div', { class: 's-item s-item-sys' });
      settingItem.append(
        el('span', { class: 's-item-ic', text: '⚙' }),
        el('span', { class: 's-item-tx', text: '設定' }),
      );
      settingItem.addEventListener('click', () => { void openSettings(); });
      toolBox.append(settingItem);
    } catch (e) {
      // 一時的な調査用。原因の位置が分からないと直しようがない。
      console.error('[shosai] refreshSide 失敗', e);
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

  // ── モバイル: 開いているものだけをタブにする ──────────────────
  // 「一覧 / データベース / エディタ」を常に並べると、何も選んでいないのに
  // エディタを開けてしまい直感に反する。開いたものがタブになり、閉じられる形にする。
  const isNarrowNow = (): boolean => window.matchMedia('(max-width: 640px)').matches;
  const foot = el('div', { class: 's-foot' });
  let openDb: { id: string; title: string } | null = null;
  let openPage: { id: string; title: string } | null = null;

  const setPane = (key: string): void => {
    // 閉じたタブが選ばれたままにならないよう、無ければ一覧へ戻す。
    const ok = key === 'side' || (key === 'main' && openDb) || (key === 'editor' && openPage);
    wrap.dataset.pane = ok ? key : 'side';
    paintFoot();
  };

  let poppingPane = false;
  const goPane = (key: string, push = true): void => {
    if (wrap.dataset.pane === key) return;
    setPane(key);
    if (push && !poppingPane) history.pushState({ shosai: true, shosaiPane: key }, '', location.pathname);
  };

  const closeTab = (key: 'main' | 'editor'): void => {
    if (key === 'main') { openDb = null; activeDatabaseId = null; }
    else { openPage = null; activePageId = null; }
    if (wrap.dataset.pane === key) setPane('side'); else paintFoot();
    void refreshSide();
  };

  function paintFoot(): void {
    foot.innerHTML = '';
    const cur = wrap.dataset.pane ?? 'side';
    const tabs: Array<{ key: string; label: string; closable: boolean }> = [
      { key: 'side', label: '一覧', closable: false },
    ];
    if (openDb) tabs.push({ key: 'main', label: openDb.title || 'データベース', closable: true });
    if (openPage) tabs.push({ key: 'editor', label: openPage.title || 'ページ', closable: true });
    for (const t of tabs) {
      const b = el('button', { class: `s-foot-btn${t.key === cur ? ' on' : ''}`, type: 'button' });
      b.append(el('span', { class: 's-foot-lb', text: t.label }));
      if (t.closable) {
        const x = el('span', { class: 's-foot-x', text: '×', title: '閉じる' });
        x.addEventListener('click', (ev) => { ev.stopPropagation(); closeTab(t.key as 'main' | 'editor'); });
        b.append(x);
      }
      b.addEventListener('click', () => goPane(t.key));
      foot.append(b);
    }
    // 開いていないペインは畳む。広い画面でも、開いていないものは出さない。
    // 何も選んでいないのに空のエディタが場所を取っているのは落ち着かない。
    const narrow = isNarrowNow();
    database.el.style.display = openDb || (!narrow && !openPage) ? '' : 'none';
    editor.el.style.display = openPage ? '' : 'none';
  }

  // 開いたものをタブとして登録する。ここが唯一の登録点。
  openedDatabase = (id, title) => { openDb = { id, title }; goPane('main'); };
  openedPage = (id, title) => { openPage = { id, title }; goPane('editor'); };
  closeTabByKey = closeTab;

  container.append(foot);

  // モバイルの「戻る」でブラウザごと閉じないようにする。ペインの移動を履歴に積み、
  // 戻る操作は前のペインへ返す。積まないと、最初の画面で戻る＝離脱になってしまう。
  window.addEventListener('popstate', (e) => {
    // ポップオーバー（選択肢・参照先・取り込み）が開いていれば、まずそれを閉じる。
    const overlays = document.querySelectorAll('.s-overlay, .s-pop');
    if (overlays.length) {
      overlays.forEach((n) => n.remove());
      history.pushState({ shosai: true, shosaiPane: wrap.dataset.pane ?? 'side' }, '', location.pathname);
      return;
    }
    const st = (e.state ?? null) as { shosaiPane?: string } | null;
    poppingPane = true;
    setPane(st?.shosaiPane ?? 'side');
    poppingPane = false;
  });

  setPane((history.state as { shosaiPane?: string } | null)?.shosaiPane ?? 'side');
  history.replaceState(
    { shosai: true, shosaiPane: wrap.dataset.pane ?? 'side' }, '', location.pathname,
  );

  // 引き下げて更新はブラウザ標準に任せる（body が document スクロールなら効く）。
  // 自前で touchmove を拾うとネイティブの挙動と二重になり、どちらも中途半端になる。

  await refreshSide();
}
