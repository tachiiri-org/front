// Notion 連携のパネル。接続 → データソース選択 → 取り込み → 進捗。
//
// 取り込みはワークフローに投げるので、この画面を閉じても走り続ける。進捗は
// importId で問い合わせる。落ちた型・ブロックは必ず表に出す（黙って消えたと
// 思われるのが一番まずい）。

import * as api from './api';
import type { NotionConnection, NotionSource } from './api';
import { el } from './style';

const DROP_LABEL: Record<string, string> = {
  people: '担当者', files: 'ファイル', formula: '数式', rollup: 'ロールアップ',
  created_by: '作成者', last_edited_by: '最終更新者', verification: '検証', button: 'ボタン',
  image: '画像', video: '動画', audio: '音声', file: 'ファイル', pdf: 'PDF',
  bookmark: 'ブックマーク', embed: '埋め込み', link_preview: 'リンクプレビュー',
  equation: '数式ブロック', table: '表', table_row: '表の行',
  table_of_contents: '目次', breadcrumb: 'パンくず', link_to_page: 'ページリンク',
  toggle: 'トグル', callout: 'コールアウト', synced_block: '同期ブロック',
  column_list: 'カラム', column: 'カラム', template: 'テンプレート',
};

function describeDropped(dropped: Record<string, number>): string[] {
  const lost: string[] = [];
  const flattened: string[] = [];
  for (const [key, n] of Object.entries(dropped)) {
    const [kind, name] = key.split(':');
    const label = DROP_LABEL[name] ?? name;
    if (kind === 'flattened') flattened.push(`${label} ${n}件`);
    else lost.push(`${label} ${n}件`);
  }
  const out: string[] = [];
  if (lost.length) out.push(`取り込めなかったもの: ${lost.join(' / ')}`);
  if (flattened.length) out.push(`段落に均したもの（中身は残っています）: ${flattened.join(' / ')}`);
  return out;
}

export interface NotionView {
  el: HTMLElement;
  refresh: () => Promise<void>;
}

export function createNotionView(opts: {
  onError: (message: string) => void;
  /** 取り込みが完了したときだけ呼ぶ。進捗中は呼ばない（左ペイン全体が点滅するため）。 */
  onImported: () => void;
  /** 取り込み中の行数更新。中央ペインだけを静かに描き直す。 */
  onProgress: (databaseId: string) => void;
}): NotionView {
  const root = el('div', { class: 's-side-sec' });

  const guard = async (fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch (e) { opts.onError(e instanceof Error ? e.message : String(e)); }
  };

  // ── 取り込みダイアログ ────────────────────────────────────────
  const openImportDialog = async (conn: NotionConnection): Promise<void> => {
    const overlay = el('div', { class: 's-overlay' });
    const pop = el('div', { class: 's-pop s-notion-dialog' });
    overlay.addEventListener('click', () => { overlay.remove(); pop.remove(); });
    document.body.append(overlay, pop);

    const head = el('div', { class: 's-notion-head' });
    head.append(el('span', { text: `${conn.workspaceName ?? 'Notion'} から取り込む` }));
    pop.append(head);

    const body = el('div', { class: 's-notion-body' });
    body.append(el('div', { class: 's-note', text: 'データソースを読み込んでいます…' }));
    pop.append(body);

    let sources: NotionSource[] = [];
    try {
      sources = (await api.listSources(conn.connectionId)).sources;
    } catch (e) {
      body.innerHTML = '';
      body.append(el('div', { class: 's-note', text: `読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}` }));
      return;
    }

    body.innerHTML = '';
    if (!sources.length) {
      body.append(el('div', {
        class: 's-note',
        text: '見えるデータソースがありません。Notion 側の接続設定で、取り込みたいページ／データベースを共有してください。',
      }));
      return;
    }

    // 本文まで取り込むか。既定は入れる（B-2 の要求）。
    const bodyToggleWrap = el('label', { class: 's-notion-opt' });
    const bodyToggle = el('input', { type: 'checkbox' }) as HTMLInputElement;
    bodyToggle.checked = true;
    bodyToggleWrap.append(bodyToggle, el('span', { text: 'ページの本文（ブロック）も取り込む' }));
    body.append(bodyToggleWrap);

    const list = el('div', { class: 's-notion-list' });
    for (const src of sources) {
      const row = el('div', { class: 's-notion-src' });
      const label = el('div', { class: 's-notion-src-tx' });
      label.append(
        el('div', { class: 's-notion-src-t', text: src.title || '（無題のデータソース）' }),
        el('div', { class: 's-notion-src-m', text: `${src.propertyCount} 列` }),
      );
      const btn = el('button', { class: 's-btn', text: '取り込む' });
      btn.addEventListener('click', () => {
        void guard(async () => {
          btn.disabled = true;
          btn.textContent = '開始中…';
          const started = await api.startImport({
            connectionId: conn.connectionId,
            dataSourceId: src.id,
            title: src.title || 'Notion',
            includeBody: bodyToggle.checked,
          });
          overlay.remove(); pop.remove();
          watchImport(started.importId, src.title || 'Notion', started.databaseId);
        });
      });
      row.append(label, btn);
      list.append(row);
    }
    body.append(list);
  };

  // ── 進捗表示 ─────────────────────────────────────────────────
  // ワークフローは非同期なので、画面を閉じても走り続ける。ここはあくまで見物窓。
  const progress = el('div', { class: 's-notion-progress' });
  progress.style.display = 'none';
  root.append(progress);

  const watchImport = (importId: string, title: string, databaseId: string): void => {
    progress.style.display = '';
    progress.innerHTML = '';
    const line = el('div', { class: 's-notion-prog-line', text: `${title} を取り込んでいます…` });
    progress.append(line);

    let stopped = false;
    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        const res = await api.importStatus(importId);
        const st = res.status?.status ?? 'unknown';
        if (st === 'complete') {
          stopped = true;
          const out = res.status.output ?? {};
          progress.innerHTML = '';
          progress.append(el('div', { class: 's-notion-prog-done', text: `${title}: 完了` }));
          const rows = out.rows ?? 0;
          const blocks = out.blocks ?? 0;
          progress.append(el('div', {
            class: 's-note',
            text: blocks === 0 && rows > 0
              ? `${rows} 行（本文のあるページはありませんでした）`
              : `${rows} 行 / ${blocks} ブロック`,
          }));
          for (const l of describeDropped(out.dropped ?? {})) {
            progress.append(el('div', { class: 's-notion-drop', text: l }));
          }
          if (out.unresolvedRelations) {
            progress.append(el('div', {
              class: 's-notion-warn',
              text: `未解決のリレーション ${out.unresolvedRelations} 件（参照先が今回の取り込みに含まれていません）`,
            }));
          }
          if (out.failed?.length) {
            progress.append(el('div', {
              class: 's-notion-warn',
              text: `取り込めなかったページ ${out.failed.length} 件: ${out.failed[0]}`,
            }));
          }
          opts.onImported();
          return;
        }
        if (st === 'errored' || st === 'terminated') {
          stopped = true;
          progress.innerHTML = '';
          progress.append(el('div', { class: 's-notion-prog-err', text: `${title}: 失敗しました` }));
          progress.append(el('div', { class: 's-note', text: String(res.status.error ?? '').slice(0, 200) }));
          return;
        }
        // 何件入ったかを実測して出す。ワークフローの状態だけでは進捗が分からない。
        // 左ペイン全体は描き直さない（点滅する）。数字の行だけを書き換える。
        let done = 0;
        try {
          const dbs = await api.listDatabases();
          done = dbs.databases.find((d) => d.databaseId === databaseId)?.rowCount ?? 0;
        } catch { /* 取れなくても進捗表示を止めない */ }
        line.textContent = done
          ? `${title}: ${done} 行を取り込みました…`
          : `${title} を取り込んでいます…（${st}）`;
        opts.onProgress(databaseId);
      } catch {
        // 進捗の取得に失敗しても取り込み自体は続いている。監視だけ諦める。
        line.textContent = `${title}: 進捗を取得できません（取り込みは継続中）`;
      }
      setTimeout(() => { void tick(); }, 3000);
    };
    void tick();
  };

  // ── 一覧の描画 ───────────────────────────────────────────────
  const refresh = async (): Promise<void> => {
    // 進捗表示は消さずに残す（取り込み中の再描画で消えると不安になる）。
    [...root.children].forEach((c) => { if (c !== progress) c.remove(); });

    const head = el('div', { class: 's-side-head' });
    head.append(el('span', { text: 'NOTION' }), el('span', { class: 's-side-head-sp' }));
    root.insertBefore(head, progress);

    let connections: NotionConnection[] = [];
    try {
      connections = (await api.listConnections()).connections;
    } catch (e) {
      // 未設定（NOTION_CLIENT_ID 未投入など）でも画面全体は壊さない。
      root.insertBefore(el('div', { class: 's-empty', text: `連携を確認できません: ${e instanceof Error ? e.message : String(e)}` }), progress);
      return;
    }

    for (const c of connections) {
      const item = el('div', { class: 's-item' });
      item.append(
        el('span', { class: 's-item-ic', text: '◈' }),
        el('span', { class: 's-item-tx', text: c.workspaceName || 'Notion ワークスペース' }),
        el('span', { class: 's-item-ct', text: String(c.sourceCount) }),
      );
      item.title = '取り込むデータソースを選ぶ';
      item.addEventListener('click', () => { void openImportDialog(c); });
      root.insertBefore(item, progress);
    }

    // 接続の追加は常に出す（複数ワークスペースを繋げる）。
    const connect = el('a', { class: 's-item s-notion-connect', href: '/auth/notion' });
    connect.append(
      el('span', { class: 's-item-ic', text: '＋' }),
      el('span', { class: 's-item-tx', text: connections.length ? '別のワークスペースを繋ぐ' : 'Notion と接続する' }),
    );
    root.insertBefore(connect, progress);

    if (!connections.length) {
      root.insertBefore(el('div', {
        class: 's-empty',
        text: '接続すると、Notion 側で選んだページ／データベースだけが見えます。',
      }), progress);
    }
  };

  return { el: root, refresh };
}

/** コールバックから戻ったときの ?notion=... を人間に読める形にする。 */
export function notionReturnMessage(): { text: string; ok: boolean } | null {
  const q = new URLSearchParams(location.search);
  const v = q.get('notion');
  const reason = q.get('reason');
  if (!v) return null;
  const map: Record<string, { text: string; ok: boolean }> = {
    connected: { text: 'Notion と接続しました。', ok: true },
    cancelled: { text: 'Notion の接続をキャンセルしました。', ok: false },
    state_mismatch: { text: '接続の検証に失敗しました（state 不一致）。もう一度お試しください。', ok: false },
    unauthenticated: { text: 'ログインが切れていました。ログインし直してから接続してください。', ok: false },
    failed: { text: 'Notion との接続に失敗しました。', ok: false },
  };
  const hit = map[v];
  if (!hit) return null;
  // 理由が分かるならそのまま見せる。伏せると同じ失敗を繰り返すことになる。
  return reason && !hit.ok ? { text: `${hit.text}（${reason}）`, ok: false } : hit;
}
