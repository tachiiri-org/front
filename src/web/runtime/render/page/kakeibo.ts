// 家計簿（kakeibo.tachiiri.com）の画面。
//
// 取り込みは、カード明細ページで動かすブックマークレットが window.open + postMessage で
// データを渡してくる。明細ページ側から外部オリジンへ直接 fetch させない設計なので、
// 相手サイトの CSP に左右されない（実測では CSP も COOP も無かったが、依存しない方が堅い）。
//
// 明細は請求年月ごとの全削除・全追加なので、行に付けた分類は残らない。分類は「店」に
// 紐づけて毎回復元する。だから画面の主役は明細そのものより、店への費目・略名の付与になる。

import { buildBookmarkletUrl } from './kakeibo-bookmarklet';

type StatementRow = {
  statement_id: string;
  used_on: string;
  pay_month: string;
  pay_type: string;
  amount_jpy: number;
  is_foreign: number;
  shop: string;
  shop_alias: string | null;
  shop_id: string;
  card: string;
  currency: string | null;
  foreign_amount: string | null;
  note: string | null;
  categories: string[];
};

const yen = (n: number): string => `${Number(n || 0).toLocaleString('ja-JP')}円`;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (style) e.setAttribute('style', style);
  if (text !== undefined) e.textContent = text;
  return e;
};

const S = {
  page: 'max-width:960px;margin:0 auto;padding:16px;font:14px/1.7 system-ui,sans-serif;',
  h1: 'font-size:20px;font-weight:600;margin:0 0 12px;',
  bar: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;',
  card: 'border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:12px;',
  table: 'width:100%;border-collapse:collapse;font-size:13px;',
  th: 'text-align:left;border-bottom:2px solid #ccc;padding:6px 4px;white-space:nowrap;',
  td: 'border-bottom:1px solid #eee;padding:6px 4px;vertical-align:top;',
  num: 'border-bottom:1px solid #eee;padding:6px 4px;text-align:right;white-space:nowrap;',
  btn: 'padding:6px 12px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer;',
  input: 'padding:4px 6px;border:1px solid #bbb;border-radius:4px;font:inherit;',
  note: 'color:#666;font-size:12px;',
  err: 'color:#c0392b;',
  ok: 'color:#1e7a3c;',
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/v1/kakeibo${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * ブックマークレットからの取り込みを待ち受ける。
 *
 * 未ログインだと認証リダイレクトを挟むぶん受信側の準備が遅れるため、送り手は ack が返るまで
 * 送り続ける実装になっている。こちらは読み込み直後からリスナを張り、受け取ったら ack を返す。
 */
function listenForImport(status: HTMLElement, onDone: () => void): void {
  window.addEventListener('message', async (ev: MessageEvent) => {
    const data = ev.data as { type?: string; payload?: unknown } | null;
    if (!data || data.type !== 'gp-import') return;
    // 送り主のオリジンを確認する。カード明細ページ以外からは受け取らない。
    if (!/^https:\/\/secure\.goldpoint\.co\.jp$/.test(ev.origin)) {
      status.textContent = `受信を拒否しました（想定外の送信元: ${ev.origin}）`;
      status.setAttribute('style', S.err);
      return;
    }
    (ev.source as Window | null)?.postMessage({ type: 'gp-import-ack' }, ev.origin);

    status.textContent = '取り込み中…';
    status.setAttribute('style', S.note);
    try {
      const res = await api<{ rowCount: number; rowsTotal: number; billingMonth: string; replaced: number }>(
        '/import',
        { method: 'POST', body: JSON.stringify(data.payload) },
      );
      status.textContent =
        `取り込み完了: ${res.billingMonth} / ${res.rowCount}件 / ${yen(res.rowsTotal)}` +
        (res.replaced ? `（既存 ${res.replaced} 件を差し替え）` : '');
      status.setAttribute('style', S.ok);
      onDone();
    } catch (e) {
      // 合計不一致は 409。取りこぼしを黙って登録するより落とす方が安全なので、原因をそのまま出す。
      status.textContent = `取り込み失敗: ${String(e instanceof Error ? e.message : e)}`;
      status.setAttribute('style', S.err);
    }
  });
}

function renderShopEditor(row: StatementRow, reload: () => void): HTMLElement {
  const box = el('div', 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;');
  const alias = el('input', S.input + 'width:110px;') as HTMLInputElement;
  alias.value = row.shop_alias ?? '';
  alias.placeholder = '略名';
  const cats = el('input', S.input + 'width:160px;') as HTMLInputElement;
  cats.value = row.categories.join(', ');
  cats.placeholder = '費目（カンマ区切り）';
  const save = el('button', S.btn + 'padding:3px 8px;font-size:12px;', '保存');
  save.addEventListener('click', async () => {
    save.textContent = '保存中';
    try {
      await api(`/shops/${encodeURIComponent(row.shop_id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          alias: alias.value,
          categories: cats.value.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });
      save.textContent = '保存済';
      // 店に付けた費目・略名は同じ店の全明細に効くので、一覧を引き直す
      reload();
    } catch (e) {
      save.textContent = '失敗';
      console.error(e);
    }
  });
  box.append(alias, cats, save);
  return box;
}

export async function renderKakeibo(root: HTMLElement): Promise<void> {
  const page = el('div', S.page);
  root.appendChild(page);

  page.appendChild(el('h1', S.h1, '家計簿 — カード明細'));

  const status = el('div', S.note, 'カード明細ページのブックマークレットから取り込めます。');
  const bar = el('div', S.bar);
  const monthSel = el('select', S.input) as HTMLSelectElement;
  const reloadBtn = el('button', S.btn, '再読込');
  bar.append(el('span', '', '請求年月'), monthSel, reloadBtn);
  page.append(bar, status);

  // ブックマークレットの受け渡し。ドラッグ登録は本番の運用として想定していないので、
  // クリップボードへコピーしてブックマークのURL欄に貼ってもらう。登録は一度きりで済む。
  // 送信先は今見ているオリジンを埋め込むため、dev/stage/本番でそれぞれ正しいものが作られる。
  const setup = el('div', S.card);
  setup.appendChild(el('div', 'font-weight:600;margin-bottom:6px;', '取り込み用ブックマークレット'));
  setup.appendChild(el('div', S.note,
    'コピーしてブックマークを新規作成し、URL 欄に貼り付けてください。登録は一度だけで済みます。' +
    'カードのご利用明細ページを開いた状態でそのブックマークを開くと、この画面へ取り込まれます。'));
  const copyRow = el('div', 'display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;');
  const copyBtn = el('button', S.btn, 'ブックマークレットをコピー');
  const copyMsg = el('span', S.note, '');
  copyBtn.addEventListener('click', () => void (async () => {
    const url = buildBookmarkletUrl(location.origin);
    try {
      await navigator.clipboard.writeText(url);
      copyMsg.textContent = `コピーしました（${url.length.toLocaleString('ja-JP')} 文字 / 送信先 ${location.origin}）`;
      copyMsg.setAttribute('style', S.ok);
    } catch {
      // クリップボード API が使えない場合は選択してコピーできるように出す
      const ta = el('textarea', 'width:100%;height:80px;margin-top:8px;font:11px monospace;') as HTMLTextAreaElement;
      ta.value = url;
      copyRow.parentElement?.appendChild(ta);
      ta.select();
      copyMsg.textContent = '自動コピーできませんでした。下の内容を手動でコピーしてください。';
      copyMsg.setAttribute('style', S.err);
    }
  })());
  copyRow.append(copyBtn, copyMsg);
  setup.appendChild(copyRow);
  page.appendChild(setup);

  const summary = el('div', S.card);
  const listBox = el('div');
  page.append(summary, listBox);

  const loadMonths = async (): Promise<void> => {
    const { months } = await api<{ months: string[] }>('/months');
    const keep = monthSel.value;
    monthSel.innerHTML = '';
    for (const m of months) {
      const o = el('option', '', m) as HTMLOptionElement;
      o.value = m;
      monthSel.appendChild(o);
    }
    if (keep && months.includes(keep)) monthSel.value = keep;
    if (!months.length) {
      summary.textContent = 'まだ取り込みがありません。';
      listBox.innerHTML = '';
    }
  };

  const loadRows = async (): Promise<void> => {
    const bm = monthSel.value;
    if (!bm) return;
    const res = await api<{
      latestImport: { as_of?: string; captured_at?: string; shown_total?: number; rows_total?: number; row_count?: number } | null;
      rows: StatementRow[];
    }>(`/statements?billingMonth=${encodeURIComponent(bm)}`);

    const m = res.latestImport;
    summary.innerHTML = '';
    if (m) {
      summary.append(
        el('div', 'font-weight:600;', `${bm} / ${m.row_count ?? res.rows.length}件 / ${yen(m.rows_total ?? 0)}`),
        // 「現在判明分」は確定前スナップショットの基準日。日次で取り直す前提なので必ず見せる。
        el('div', S.note, `取得時点: ${m.as_of ?? '不明'} ／ 取り込み: ${m.captured_at ?? ''}`),
      );
    }

    const table = el('table', S.table);
    const head = el('tr');
    for (const h of ['利用日', '店', '費目・略名', 'カード', '支払', '金額']) {
      head.appendChild(el('th', S.th, h));
    }
    table.appendChild(head);

    for (const r of res.rows) {
      const tr = el('tr');
      tr.appendChild(el('td', S.td, r.used_on));
      const shopCell = el('td', S.td);
      shopCell.appendChild(el('div', '', r.shop_alias || r.shop));
      if (r.shop_alias) shopCell.appendChild(el('div', S.note, r.shop));
      if (r.is_foreign) shopCell.appendChild(el('div', S.note, `${r.foreign_amount} ${r.currency}`));
      tr.appendChild(shopCell);
      const catCell = el('td', S.td);
      catCell.appendChild(renderShopEditor(r, () => void loadRows()));
      tr.appendChild(catCell);
      tr.appendChild(el('td', S.td, r.card));
      tr.appendChild(el('td', S.td, r.pay_type));
      tr.appendChild(el('td', S.num, yen(r.amount_jpy)));
      table.appendChild(tr);
    }
    listBox.innerHTML = '';
    listBox.appendChild(table);
  };

  monthSel.addEventListener('change', () => void loadRows());
  reloadBtn.addEventListener('click', () => void (async () => { await loadMonths(); await loadRows(); })());

  listenForImport(status, () => void (async () => { await loadMonths(); await loadRows(); })());

  try {
    await loadMonths();
    await loadRows();
  } catch (e) {
    status.textContent = `読み込み失敗: ${String(e instanceof Error ? e.message : e)}`;
    status.setAttribute('style', S.err);
  }
}
