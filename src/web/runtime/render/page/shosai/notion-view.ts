// Notion 連携のパネル。接続 → データソース選択 → 取り込み → 進捗。
//
// 取り込みはワークフローに投げるので、この画面を閉じても走り続ける。進捗は
// importId で問い合わせる。落ちた型・ブロックは必ず表に出す（黙って消えたと
// 思われるのが一番まずい）。

import * as api from './api';
import type { NotionConnection, NotionSource } from './api';
import { el } from './style';

const DROP_LABEL: Record<string, string> = {
  '未共有のページへのリンク': 'ページリンク（連携対象外）',
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
  // 共有不足は人が直せるので、直し方まで書く。
  if (dropped['block:未共有のページへのリンク']) {
    out.push('「インポートログ」に記録しました。リンク先を Notion 側で共有すると取り込めます（ページの ••• → 接続）');
  }
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
    head.append(el('span', { class: 's-notion-head-t', text: `${conn.workspaceName ?? 'Notion'} から取り込む` }));
    // 見えるデータソースは Notion 側で共有したものだけ。連携後に作ったものや、
    // 共有していないページはここに出てこないので、選び直しに行く導線を同じ画面に置く。
    const regrant = el('a', { class: 's-notion-regrant', href: '/auth/notion', text: '⟳ 再連携' });
    regrant.title = '連携後に作ったデータベースや、未共有のページはここから追加できます';
    head.append(regrant);
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
        text: '見えるデータソースがありません。上の「再連携」から、取り込みたいページ／データベースを選んでください。',
      }));
      return;
    }

    // 本文まで取り込むか。既定は入れる（B-2 の要求）。
    const bodyToggleWrap = el('label', { class: 's-notion-opt' });
    const bodyToggle = el('input', { type: 'checkbox' }) as HTMLInputElement;
    bodyToggle.checked = true;
    bodyToggleWrap.append(bodyToggle, el('span', { text: 'ページの本文（ブロック）も取り込む' }));
    body.append(bodyToggleWrap);

    // 複数選べるようにする。リレーションは相手が入っていないと機能しないので、
    // 1つ選んだら指し先も一緒に選べる必要がある。
    const picked = new Map<string, string>();   // dataSourceId -> title
    const known = new Map(sources.map((s) => [s.id, s.title] as const));
    const list = el('div', { class: 's-notion-list' });
    const note = el('div', { class: 's-note' });

    const rowOf = (id: string, title: string, count: string): HTMLElement => {
      const row = el('div', { class: 's-notion-src' });
      const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
      cb.checked = picked.has(id);
      const label = el('div', { class: 's-notion-src-tx' });
      label.append(
        el('div', { class: 's-notion-src-t', text: title || '（無題のデータソース）' }),
        el('div', { class: 's-notion-src-m', text: count }),
      );
      row.append(cb, label);
      const toggle = (): void => {
        if (cb.checked) picked.set(id, title); else picked.delete(id);
        updateStart();
        if (cb.checked) void addRelated(id);
      };
      cb.addEventListener('change', toggle);
      label.addEventListener('click', () => { cb.checked = !cb.checked; toggle(); });
      return row;
    };

    // 指し先をたどって候補に足す。既に一覧にあるものはチェックだけ入れる。
    const addRelated = async (id: string): Promise<void> => {
      note.textContent = 'リレーションの指し先を調べています…';
      try {
        const { related } = await api.relatedSources(conn.connectionId, id);
        let added = 0;
        for (const r of related) {
          if (!picked.has(r.id)) { picked.set(r.id, r.title || known.get(r.id) || 'Notion'); added++; }
          if (!known.has(r.id)) {
            known.set(r.id, r.title);
            list.append(rowOf(r.id, r.title, '（リレーションの指し先）'));
          }
        }
        // 既に一覧にある行のチェック状態を反映し直す。
        for (const [i, s2] of sources.entries()) {
          const cb = list.children[i]?.querySelector('input') as HTMLInputElement | undefined;
          if (cb) cb.checked = picked.has(s2.id);
        }
        note.textContent = added
          ? `リレーションの指し先 ${added} 件も選びました（外すこともできます）`
          : 'リレーションの指し先はありません';
        updateStart();
      } catch (e) {
        note.textContent = `指し先を調べられませんでした: ${e instanceof Error ? e.message : String(e)}`;
      }
    };

    for (const src of sources) list.append(rowOf(src.id, src.title, `${src.propertyCount} 列`));
    body.append(list, note);

    const start = el('button', { class: 's-btn s-notion-start', text: '取り込む' });
    const updateStart = (): void => {
      start.textContent = picked.size > 1 ? `${picked.size} 件を取り込む` : '取り込む';
      (start as HTMLButtonElement).disabled = picked.size === 0;
    };
    updateStart();
    start.addEventListener('click', () => {
      void guard(async () => {
        (start as HTMLButtonElement).disabled = true;
        start.textContent = '開始中…';
        const targets = [...picked.entries()];
        overlay.remove(); pop.remove();
        // 直列に投げる。同時に走らせると Notion のレート制限に当たる。
        for (const [id, title] of targets) {
          const started = await api.startImport({
            connectionId: conn.connectionId, dataSourceId: id,
            title: title || 'Notion', includeBody: bodyToggle.checked,
          });
          watchImport(started.importId, title || 'Notion', started.databaseId);
        }
      });
    });
    body.append(start);
  };

  // ── 進捗表示 ─────────────────────────────────────────────────
  // ワークフローは非同期なので、画面を閉じても走り続ける。ここはあくまで見物窓。
  const progress = el('div', { class: 's-notion-progress' });
  progress.style.display = 'none';
  root.append(progress);

  /** 進捗の枠を描き直す。走行中でも失敗が見えることが要点。 */
  const paintProgress = async (databaseId: string, title: string, workflowStatus: string): Promise<void> => {
    let p: api.ImportProgress | null = null;
    try { p = await api.importProgress(databaseId); } catch { /* 取れなくても表示は続ける */ }
    progress.innerHTML = '';
    const st = p?.state;
    const rows = st?.rows ?? p?.rowsInDb ?? 0;
    const blocks = st?.blocks ?? 0;
    // 行数はここには出さない。取り込み中のものは左ペインに、割合と残り時間つきで出る。
    // 同じことを二か所に書くと、片方だけ古い数字が残る。
    void rows; void blocks; void title;
    const fails = p?.failures ?? [];
    if (fails.length) {
      for (const f of fails.slice(0, 5)) {
        progress.append(el('div', {
          class: 's-notion-fail',
          text: `${f.notionId ? f.notionId.slice(0, 8) + '… ' : ''}${f.message}`,
        }));
      }
    }
  };

  const watchImport = (importId: string, title: string, databaseId: string): void => {
    let stopped = false;
    progress.style.display = '';
    progress.innerHTML = '';
    const line = el('div', { class: 's-notion-prog-line', text: `${title} を取り込んでいます…` });
    progress.append(line);
    const stop = el('button', { class: 's-notion-stop', text: '中止' });
    stop.addEventListener('click', () => {
      if (!confirm(`${title} の取り込みを中止しますか。ここまで入ったぶんは残ります。`)) return;
      void guard(async () => {
        await api.cancelImport(importId, databaseId);
        stopped = true;
        progress.innerHTML = '';
        progress.append(el('div', { class: 's-notion-prog-err', text: `${title}: 中止しました` }));
        opts.onImported();
      });
    });
    progress.append(stop);

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
          // 行数・ブロック数はここには出さない。実体を引き継いだ回のものは 0 になり、
          // 「0 行 / 0 ブロック」と嘘を言う。数はデータベースの一覧が持っている。
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
              class: 's-notion-warn', text: `取り込めなかったページ ${out.failed.length} 件`,
            }));
            for (const f of out.failed.slice(0, 5)) {
              progress.append(el('div', { class: 's-notion-fail', text: f }));
            }
          }
          opts.onImported();
          return;
        }
        if (st === 'errored' || st === 'terminated') {
          stopped = true;
          progress.innerHTML = '';
          progress.append(el('div', { class: 's-notion-prog-err', text: `${title}: 失敗しました` }));
          progress.append(el('div', { class: 's-note', text: String(res.status.error ?? '').slice(0, 200) }));
          // どこまで進んで何で落ちたかは DO 側の記録にしかない。
          try {
            const p = await api.importProgress(databaseId);
            progress.append(el('div', { class: 's-note', text: `${p.rowsInDb} 行まで取り込み済み` }));
            for (const f of p.failures.slice(0, 5)) {
              progress.append(el('div', { class: 's-notion-fail', text: `${f.notionId ? f.notionId.slice(0,8) + '… ' : ''}${f.message}` }));
            }
          } catch { /* 取れなければ諦める */ }
          return;
        }
        // ワークフローの状態は running としか言わないので、DO に書かれた進捗を読む。
        // 左ペイン全体は描き直さない（点滅する）。この枠の中だけを書き換える。
        await paintProgress(databaseId, title, st);
      } catch {
        // 進捗の取得に失敗しても取り込み自体は続いている。監視だけ諦める。
        line.textContent = `${title}: 進捗を取得できません（取り込みは継続中）`;
      }
      setTimeout(() => { void tick(); }, 3000);
    };
    void tick();
  };

  // ── 一覧の描画 ───────────────────────────────────────────────
  /**
   * 走行中の取り込みを拾い直す。画面を再読み込みしても進捗に戻れるようにする。
   * ワークフローの importId は覚えていないので、DO 側の状態だけを見て表示する。
   */
  const resumeRunning = async (): Promise<void> => {
    try {
      const dbs = await api.listDatabases();
      const running = dbs.databases.find((d) => d.syncStatus === 'running');
      if (!running) return;
      progress.style.display = '';
      await paintProgress(running.databaseId, running.title || 'Notion', 'running');
      // importId が無いので、DO の進捗だけを見張る。完了すると status が complete になる。
      const poll = async (): Promise<void> => {
        const p = await api.importProgress(running.databaseId).catch(() => null);
        if (p?.state?.status === 'complete') {
          await paintProgress(running.databaseId, running.title || 'Notion', 'complete');
          opts.onImported();
          return;
        }
        await paintProgress(running.databaseId, running.title || 'Notion', 'running');
        opts.onProgress(running.databaseId);
        setTimeout(() => { void poll(); }, 3000);
      };
      setTimeout(() => { void poll(); }, 3000);
    } catch { /* 拾えなくても画面は動く */ }
  };

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

    // 連携後に Notion 側で作ったページやデータベースは、そのままでは見えない。
    // アクセス範囲は同意画面のページピッカーで決まり、後から自動では広がらないため、
    // もう一度同意画面に行って選び直す導線を出す。
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
    void resumeRunning();
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
