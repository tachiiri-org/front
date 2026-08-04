// 家計簿（kakeibo.tachiiri.com）の画面。
//
// 取り込みは2経路ある。
//  - 確定前の月: カード明細ページのブックマークレットが window.open + postMessage で渡す
//  - 確定済みの月: CSV 直リンクが空を返すので、画面から落としたファイルを読む
//
// 明細は請求年月ごとの全削除・全追加なので、行に付けた分類は残らない。分類は「店」に
// 紐づけて毎回復元する。だから画面の主役は明細そのものより、店への費目・略名の付与になる。
//
// 配色は CSS 変数で持ち、prefers-color-scheme と [data-theme] の両方に追随する。
// インラインスタイルではメディアクエリを書けないため、スタイルは class に寄せている。

import { buildBookmarkletUrl } from './kakeibo-bookmarklet';
import { readGoldpointCsvFile, type ParsedCsv } from './kakeibo-csv';

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
  remark: string | null;
  categories: string[];
};

const yen = (n: number): string => `${Number(n || 0).toLocaleString('ja-JP')}円`;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const DARK = `--bg:#1e1e1e;--fg:rgba(255,255,255,.82);--muted:rgba(255,255,255,.5);
  --line:rgba(255,255,255,.12);--line2:rgba(255,255,255,.22);--card:#252526;--field:#2a2b2e;
  --ok:#4ade80;--err:#f87171;--accent:#60a5fa;--menu:#2a2b2e;--hover:rgba(255,255,255,.08)`;
const LIGHT = `--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e2e2e2;--line2:#c8c8c8;
  --card:#fafafa;--field:#fff;--ok:#1e7a3c;--err:#c0392b;--accent:#2563eb;
  --menu:#fff;--hover:#f0f0f0`;

const CSS = `
.kk{${LIGHT};width:100%;padding:12px 16px;
  font:14px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif;
  background:var(--bg);color:var(--fg);min-height:100vh;box-sizing:border-box}
@media (prefers-color-scheme:dark){.kk{${DARK}}}
:root[data-theme=dark] .kk{${DARK}}
:root[data-theme=light] .kk{${LIGHT}}
.kk-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
.kk-hd h1{font-size:17px;font-weight:600;margin:0}
.kk-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kk-card{border:1px solid var(--line);border-radius:8px;padding:10px;margin:10px 0;background:var(--card)}
.kk-note{color:var(--muted);font-size:12px}
.kk-ok{color:var(--ok);font-size:12px}
.kk-err{color:var(--err);font-size:12px}
.kk-btn{padding:5px 10px;border:1px solid var(--line2);border-radius:5px;
  background:var(--field);color:var(--fg);cursor:pointer;font:inherit;font-size:13px}
.kk-btn:hover:not(:disabled){background:var(--hover)}
.kk-btn:disabled{opacity:.45;cursor:default}
.kk-in{padding:4px 6px;border:1px solid var(--line2);border-radius:5px;
  background:var(--field);color:var(--fg);font:inherit;font-size:13px}
.kk-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.kk-tb{border-collapse:collapse;font-size:13px;min-width:100%}
.kk-tb td,.kk-tb th{white-space:nowrap}
.kk-tb td.kk-wrap{white-space:normal;min-width:180px}
.kk-tb th{text-align:left;border-bottom:1px solid var(--line2);padding:5px 8px 5px 4px;
  font-weight:600;color:var(--muted);font-size:12px}
.kk-tb th.kk-clk{cursor:pointer}
.kk-tb th.kk-on{color:var(--fg)}
.kk-tb td{border-bottom:1px solid var(--line);padding:5px 4px;vertical-align:top}
.kk-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.kk-sub{color:var(--muted);font-size:11px}
.kk-cb{position:relative;display:inline-block}
.kk-cb-menu{position:absolute;z-index:50;left:0;top:100%;min-width:100%;max-height:220px;
  overflow:auto;background:var(--menu);border:1px solid var(--line2);border-radius:6px;
  box-shadow:0 6px 20px rgba(0,0,0,.25);display:none}
.kk-cb-menu.on{display:block}
.kk-cb-item{padding:5px 10px;cursor:pointer;white-space:nowrap;font-size:13px}
.kk-cb-item:hover,.kk-cb-item.sel{background:var(--hover)}
.kk-cb-new{color:var(--accent)}
.kk-tag{display:inline-block;padding:1px 7px;margin:1px 3px 1px 0;border-radius:10px;
  border:1px solid var(--line2);font-size:12px;background:var(--field)}
.kk-tag button{border:0;background:none;color:var(--muted);cursor:pointer;padding:0 0 0 4px;font:inherit}
.kk-tag button:hover{color:var(--err)}
.kk-ms{position:relative;display:inline-flex;align-items:center;flex-wrap:wrap;gap:2px;
  min-width:150px;padding:2px 4px;border:1px solid var(--line2);border-radius:5px;
  background:var(--field);cursor:text}
.kk-ms:focus-within{border-color:var(--accent)}
.kk-ms-in{border:0;background:none;color:var(--fg);font:inherit;font-size:13px;
  outline:none;min-width:56px;flex:1;padding:2px 0}
.kk-tag.on{border-color:var(--accent);color:var(--accent)}
.kk-ov{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.6);
  display:flex;align-items:center;justify-content:center;padding:16px}
.kk-pop{background:var(--menu);color:var(--fg);border:1px solid var(--line2);border-radius:10px;
  isolation:isolate;
  max-width:min(760px,96vw);max-height:82vh;display:flex;flex-direction:column;
  box-shadow:0 12px 40px rgba(0,0,0,.5)}
.kk-pop-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:10px 12px;border-bottom:1px solid var(--line)}
.kk-pop-bd{overflow:auto;padding:0 12px 12px}
.kk-x{border:0;background:none;color:var(--muted);font-size:18px;cursor:pointer;line-height:1}
.kk-x:hover{color:var(--fg)}
.kk-tabs{display:flex;gap:4px;margin-bottom:10px}
.kk-tab{padding:4px 12px;border:1px solid transparent;border-radius:5px;cursor:pointer;
  color:var(--muted);font-size:13px;background:none}
.kk-tab.on{color:var(--fg);border-color:var(--line2);background:var(--field)}
.kk-tab:hover{background:var(--hover)}
.kk-clk{cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px}
.kk-clk:hover{color:var(--accent)}
.kk-tb tr.kk-sum td{border-top:1px solid var(--line2);font-weight:600}
`;

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
 * 検索可能なプルダウン。入力で候補を絞り込み、未登録の語はその場で新規として使える。
 * 費目も略名も語彙が育っていくものなので、固定の select では足りない。
 * 候補を出すこと自体が目的で、「食費」と「食料品」のような表記ゆれを防ぐ。
 */
function combobox(opts: {
  placeholder: string;
  value?: string;
  width: string;
  choices: () => string[];
  onPick: (v: string) => void;
  clearOnPick?: boolean;
}): HTMLElement {
  const wrap = el('span', 'kk-cb');
  const input = el('input', 'kk-in') as HTMLInputElement;
  input.placeholder = opts.placeholder;
  input.value = opts.value ?? '';
  input.style.width = opts.width;
  const menu = el('div', 'kk-cb-menu');
  wrap.append(input, menu);

  let idx = -1;
  const close = (): void => { menu.classList.remove('on'); idx = -1; };
  const pick = (v: string): void => {
    opts.onPick(v);
    input.value = opts.clearOnPick ? '' : v;
    close();
  };

  const build = (): void => {
    const q = input.value.trim().toLowerCase();
    const all = opts.choices();
    const hits = q ? all.filter((c) => c.toLowerCase().includes(q)) : all;
    menu.innerHTML = '';
    for (const c of hits.slice(0, 40)) {
      const it = el('div', 'kk-cb-item', c);
      it.addEventListener('mousedown', (e) => { e.preventDefault(); pick(c); });
      menu.appendChild(it);
    }
    const q0 = input.value.trim();
    if (q0 && !all.includes(q0)) {
      const it = el('div', 'kk-cb-item kk-cb-new', `+ ${q0}`);
      it.addEventListener('mousedown', (e) => { e.preventDefault(); pick(q0); });
      menu.appendChild(it);
    }
    menu.classList.toggle('on', menu.childElementCount > 0);
  };

  input.addEventListener('focus', build);
  input.addEventListener('input', build);
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll<HTMLElement>('.kk-cb-item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      idx = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
      items.forEach((n, i) => n.classList.toggle('sel', i === idx));
      items[idx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const t = idx >= 0 ? (items[idx]?.textContent ?? '') : input.value.trim();
      if (t) pick(t.replace(/^\+ /, ''));
    } else if (e.key === 'Escape') {
      close();
    }
  });

  return wrap;
}


type Summary = {
  months: string[];
  byCategory: { billing_month: string; category: string; total: number; cnt: number }[];
  byShop: { billing_month: string; shop_id: string; label: string; name: string; category: string; total: number; cnt: number }[];
  multiCategoryShops: number;
};

/**
 * 集計ビュー。費目×月のマトリクスと、略名別の合計を出す。
 * 略名をクリックするとその店の明細を月を跨いで表示する。
 */
async function renderSummary(host: HTMLElement): Promise<void> {
  host.innerHTML = '';
  const s = await api<Summary>('/summary');
  const months = s.months;

  if (s.multiCategoryShops > 0) {
    host.appendChild(el('div', 'kk-note',
      `費目を複数持つ店が ${s.multiCategoryShops} 件あります。合計が実額とずれないよう、集計では名前順の先頭1つに畳んでいます。`));
  }

  type Row = { key: string; sub?: string; vals: number[]; total: number };

  /**
   * 月×行のマトリクス。月ヘッダのクリックでその月の降順に並べ替える。
   * 列は固定幅にせず、はみ出したら横スクロールさせる（月は増え続けるため）。
   */
  const matrix = (
    title: string,
    rows: Row[],
    subHead: string | undefined,
    onClick?: (key: string) => void,
    controls?: HTMLElement,
  ): HTMLElement => {
    const box = el('div', 'kk-card');
    const head0 = el('div', 'kk-row');
    head0.appendChild(el('span', 'kk-note', title));
    if (controls) head0.appendChild(controls);
    box.appendChild(head0);

    // -1 は合計列での並び替え
    let sortAt = -1;
    const scroll = el('div', 'kk-scroll');
    box.appendChild(scroll);

    const draw = (): void => {
      scroll.innerHTML = '';
      const t = el('table', 'kk-tb');
      const h = el('tr');
      h.appendChild(el('th', '', ''));
      if (subHead !== undefined) h.appendChild(el('th', '', subHead));
      months.forEach((m, i) => {
        const th = el('th', 'kk-num kk-clk' + (sortAt === i ? ' kk-on' : ''),
          m.slice(2) + (sortAt === i ? ' ▼' : ''));
        th.title = `${m} の多い順に並べ替え`;
        th.addEventListener('click', () => { sortAt = i; draw(); });
        h.appendChild(th);
      });
      const thTotal = el('th', 'kk-num kk-clk' + (sortAt === -1 ? ' kk-on' : ''),
        '合計' + (sortAt === -1 ? ' ▼' : ''));
      thTotal.addEventListener('click', () => { sortAt = -1; draw(); });
      h.appendChild(thTotal);
      t.appendChild(h);

      const sorted = [...rows].sort((a, b) =>
        sortAt === -1 ? b.total - a.total : (b.vals[sortAt] ?? 0) - (a.vals[sortAt] ?? 0));

      for (const r of sorted) {
        const tr = el('tr');
        const c0 = el('td', onClick ? 'kk-clk' : '', r.key);
        if (onClick) c0.addEventListener('click', () => onClick(r.key));
        tr.appendChild(c0);
        if (subHead !== undefined) tr.appendChild(el('td', 'kk-sub', r.sub ?? ''));
        for (const v of r.vals) tr.appendChild(el('td', 'kk-num', v ? yen(v) : ''));
        tr.appendChild(el('td', 'kk-num', yen(r.total)));
        t.appendChild(tr);
      }

      const sum = el('tr', 'kk-sum');
      sum.appendChild(el('td', '', '合計'));
      if (subHead !== undefined) sum.appendChild(el('td', '', ''));
      let grand = 0;
      months.forEach((_, i) => {
        const v = sorted.reduce((a, r) => a + (r.vals[i] ?? 0), 0);
        grand += v;
        sum.appendChild(el('td', 'kk-num', yen(v)));
      });
      sum.appendChild(el('td', 'kk-num', yen(grand)));
      t.appendChild(sum);
      scroll.appendChild(t);
    };
    draw();
    return box;
  };

  // 費目 × 月
  const catAt = new Map<string, number>();
  for (const r of s.byCategory) catAt.set(`${r.category}\u0001${r.billing_month}`, r.total);
  const catRows: Row[] = [...new Set(s.byCategory.map((r) => r.category))].map((k) => {
    const vals = months.map((m) => catAt.get(`${k}\u0001${m}`) ?? 0);
    return { key: k, vals, total: vals.reduce((a, b) => a + b, 0) };
  });
  host.appendChild(matrix('費目 × 利用月', catRows, undefined));

  // 略名 × 月（費目つき・費目で絞り込める）
  const shopAt = new Map<string, number>();
  const shopId = new Map<string, string>();
  const shopCat = new Map<string, string>();
  for (const r of s.byShop) {
    const k = `${r.label}\u0001${r.billing_month}`;
    shopAt.set(k, (shopAt.get(k) ?? 0) + r.total);
    shopId.set(r.label, r.shop_id);
    shopCat.set(r.label, r.category);
  }
  const allShopRows: Row[] = [...shopId.keys()].map((k) => {
    const vals = months.map((m) => shopAt.get(`${k}\u0001${m}`) ?? 0);
    return { key: k, sub: shopCat.get(k) ?? '', vals, total: vals.reduce((a, b) => a + b, 0) };
  });

  const showDetail = async (label: string): Promise<void> => {
    const id = shopId.get(label);
    if (!id) return;
    const res = await api<{ rows: { billing_month: string; used_on: string; amount_jpy: number; shop: string; remark: string | null }[] }>(
      `/shops/${encodeURIComponent(id)}/statements`,
    );

    // 表の下に足すと画面が飛ぶので、その場に重ねる。閉じれば元の位置に戻る。
    const overlay = el('div', 'kk-ov');
    const pop = el('div', 'kk-pop');
    const hd = el('div', 'kk-pop-hd');
    hd.appendChild(el('strong', '',
      `${label}　${res.rows.length}件　${yen(res.rows.reduce((a, r) => a + r.amount_jpy, 0))}`));
    const close = el('button', 'kk-x', '×');
    close.title = '閉じる';
    hd.appendChild(close);
    pop.appendChild(hd);

    const bd = el('div', 'kk-pop-bd');
    const t = el('table', 'kk-tb');
    const h = el('tr');
    for (const x of ['利用日', '店', '金額']) h.appendChild(el('th', x === '金額' ? 'kk-num' : '', x));
    t.appendChild(h);
    for (const r of res.rows) {
      const tr = el('tr');
      tr.appendChild(el('td', '', r.used_on));
      const c = el('td', 'kk-wrap');
      c.appendChild(el('div', '', r.shop));
      if (r.remark) c.appendChild(el('div', 'kk-sub', r.remark));
      tr.appendChild(c);
      tr.appendChild(el('td', 'kk-num', yen(r.amount_jpy)));
      t.appendChild(tr);
    }
    const sc = el('div', 'kk-scroll');
    sc.appendChild(t);
    bd.appendChild(sc);
    pop.appendChild(bd);
    overlay.appendChild(pop);

    const dismiss = (): void => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') dismiss(); };
    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  };

  const shopHost = el('div', '');
  const filter = el('select', 'kk-in') as HTMLSelectElement;
  for (const c of ['（費目で絞り込み）', ...new Set(allShopRows.map((r) => r.sub ?? '').filter(Boolean))].sort()) {
    const o = el('option', '', c) as HTMLOptionElement;
    o.value = c === '（費目で絞り込み）' ? '' : c;
    filter.appendChild(o);
  }
  filter.value = '';
  const drawShops = (): void => {
    shopHost.innerHTML = '';
    const rows = filter.value ? allShopRows.filter((r) => r.sub === filter.value) : allShopRows;
    const ctrl = el('div', 'kk-row');
    ctrl.appendChild(filter);
    shopHost.appendChild(matrix('略名 × 利用月（クリックで明細）', rows, '費目', (k) => void showDetail(k), ctrl));
  };
  filter.addEventListener('change', drawShops);
  drawShops();

  host.appendChild(shopHost);
}


/**
 * Notion の select 列に近い複数選択。タグと入力欄を1つの枠に収める。
 * ボタンとテキストボックスが別要素だと編集対象が分かりにくいため。
 */
function multiSelect(opts: {
  values: string[];
  choices: () => string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}): HTMLElement {
  const wrap = el('span', 'kk-ms');
  const input = el('input', 'kk-ms-in') as HTMLInputElement;
  input.placeholder = opts.values.length ? '' : (opts.placeholder ?? '');
  const menu = el('div', 'kk-cb-menu');
  let idx = -1;

  const paint = (): void => {
    for (const n of [...wrap.querySelectorAll('.kk-tag')]) n.remove();
    opts.values.forEach((v) => {
      const t = el('span', 'kk-tag', v);
      const x = el('button', '', '×');
      x.title = '外す';
      x.addEventListener('mousedown', (e) => {
        e.preventDefault();
        opts.onChange(opts.values.filter((c) => c !== v));
      });
      t.appendChild(x);
      wrap.insertBefore(t, input);
    });
    input.placeholder = opts.values.length ? '' : (opts.placeholder ?? '');
  };

  const close = (): void => { menu.classList.remove('on'); idx = -1; };
  const pick = (v: string): void => {
    close();
    input.value = '';
    if (v && !opts.values.includes(v)) opts.onChange([...opts.values, v]);
  };

  const build = (): void => {
    const q = input.value.trim().toLowerCase();
    const all = opts.choices().filter((c) => !opts.values.includes(c));
    const hits = q ? all.filter((c) => c.toLowerCase().includes(q)) : all;
    menu.innerHTML = '';
    for (const c of hits.slice(0, 40)) {
      const it = el('div', 'kk-cb-item', c);
      it.addEventListener('mousedown', (e) => { e.preventDefault(); pick(c); });
      menu.appendChild(it);
    }
    const q0 = input.value.trim();
    if (q0 && !all.includes(q0) && !opts.values.includes(q0)) {
      const it = el('div', 'kk-cb-item kk-cb-new', `+ ${q0}`);
      it.addEventListener('mousedown', (e) => { e.preventDefault(); pick(q0); });
      menu.appendChild(it);
    }
    menu.classList.toggle('on', menu.childElementCount > 0);
  };

  input.addEventListener('focus', build);
  input.addEventListener('input', build);
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll<HTMLElement>('.kk-cb-item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      idx = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
      items.forEach((n, i) => n.classList.toggle('sel', i === idx));
      items[idx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const t = idx >= 0 ? (items[idx]?.textContent ?? '') : input.value.trim();
      if (t) pick(t.replace(/^\+ /, ''));
    } else if (e.key === 'Backspace' && input.value === '' && opts.values.length) {
      opts.onChange(opts.values.slice(0, -1));
    } else if (e.key === 'Escape') { close(); }
  });
  // 枠のどこを押しても入力に入る
  wrap.addEventListener('mousedown', (e) => {
    if (e.target === wrap) { e.preventDefault(); input.focus(); }
  });

  wrap.append(input, menu);
  paint();
  return wrap;
}

/** ブックマークレットからの取り込みを待ち受ける（未ログイン時は送り手が ack まで再送する） */
function listenForImport(status: HTMLElement, onDone: () => void): void {
  window.addEventListener('message', async (ev: MessageEvent) => {
    const data = ev.data as { type?: string; payload?: unknown } | null;
    if (!data || data.type !== 'gp-import') return;
    // 送り主のオリジンを確認する。カード明細ページ以外からは受け取らない。
    if (!/^https:\/\/secure\.goldpoint\.co\.jp$/.test(ev.origin)) {
      status.className = 'kk-err';
      status.textContent = `拒否: ${ev.origin}`;
      return;
    }
    (ev.source as Window | null)?.postMessage({ type: 'gp-import-ack' }, ev.origin);
    status.className = 'kk-note';
    status.textContent = '取り込み中';
    try {
      const res = await api<{ rowCount: number; rowsTotal: number; billingMonth: string }>(
        '/import', { method: 'POST', body: JSON.stringify(data.payload) },
      );
      status.className = 'kk-ok';
      status.textContent = `${res.billingMonth} ${res.rowCount}件 ${yen(res.rowsTotal)}`;
      onDone();
    } catch (e) {
      status.className = 'kk-err';
      status.textContent = String(e instanceof Error ? e.message : e);
    }
  });
}

/** CSV ファイルからの一括取り込み。確定済みの月はこちらでしか入らない。 */
function renderCsvImport(status: HTMLElement, onDone: () => void): HTMLElement {
  const box = el('div', 'kk-card');
  const row = el('div', 'kk-row');
  const input = el('input', 'kk-in') as HTMLInputElement;
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.multiple = true;
  const runBtn = el('button', 'kk-btn', '取り込む');
  runBtn.disabled = true;
  row.append(el('span', 'kk-note', 'CSV'), input, runBtn);
  box.appendChild(row);

  const preview = el('div', '');
  preview.style.marginTop = '8px';
  box.appendChild(preview);

  let parsed: ParsedCsv[] = [];

  input.addEventListener('change', () => void (async () => {
    parsed = [];
    preview.innerHTML = '';
    const files = [...(input.files ?? [])];
    if (!files.length) { runBtn.disabled = true; return; }
    for (const f of files) {
      try { parsed.push(await readGoldpointCsvFile(f)); }
      catch (e) {
        parsed.push({ fileName: f.name, billingMonth: '', declaredTotal: null, rowCount: 0,
          rowsTotal: 0, rows: [], errors: [String(e instanceof Error ? e.message : e)] });
      }
    }

    const table = el('table', 'kk-tb');
    const head = el('tr');
    for (const h of ['ファイル', '請求月', '件数', '合計', '']) head.appendChild(el('th', '', h));
    table.appendChild(head);
    for (const p of parsed) {
      const tr = el('tr');
      tr.appendChild(el('td', '', p.fileName));
      tr.appendChild(el('td', '', p.billingMonth || '—'));
      tr.appendChild(el('td', 'kk-num', String(p.rowCount)));
      tr.appendChild(el('td', 'kk-num', yen(p.rowsTotal)));
      const ok = p.errors.length === 0 && p.billingMonth !== '' && p.rowCount > 0;
      tr.appendChild(el('td', ok ? 'kk-ok' : 'kk-err', ok ? '可' : (p.errors[0] ?? '請求月不明')));
      table.appendChild(tr);
    }
    preview.appendChild(table);

    // 同じ請求年月のファイルを複数選ぶと、後勝ちで片方が消える。事故になるので止める。
    const months = parsed.filter((p) => p.billingMonth).map((p) => p.billingMonth);
    const dup = [...new Set(months.filter((m, i) => months.indexOf(m) !== i))];
    if (dup.length) {
      preview.appendChild(el('div', 'kk-err', `請求月が重複: ${dup.join(', ')}（月ごとの全置換なので片方が消えます）`));
    }
    runBtn.disabled = parsed.every((p) => p.errors.length || !p.billingMonth || !p.rowCount) || dup.length > 0;
  })());

  runBtn.addEventListener('click', () => void (async () => {
    runBtn.disabled = true;
    const usable = parsed.filter((p) => p.errors.length === 0 && p.billingMonth && p.rowCount > 0);
    const done: string[] = [];
    const failed: string[] = [];
    for (const p of usable) {
      status.className = 'kk-note';
      status.textContent = `取り込み中 ${p.fileName}`;
      try {
        await api('/import', {
          method: 'POST',
          body: JSON.stringify({
            source: 'goldpoint-csv', billingMonth: p.billingMonth,
            capturedAt: new Date().toISOString(), rowCount: p.rowCount,
            rowsTotal: p.rowsTotal, shownTotal: p.declaredTotal, rows: p.rows,
          }),
        });
        done.push(`${p.billingMonth} ${p.rowCount}件`);
      } catch (e) {
        failed.push(`${p.fileName}: ${String(e instanceof Error ? e.message : e)}`);
      }
    }
    status.className = failed.length ? 'kk-err' : 'kk-ok';
    status.textContent = [done.join(' / '), failed.join(' / ')].filter(Boolean).join('　');
    input.value = '';
    parsed = [];
    preview.innerHTML = '';
    onDone();
  })());

  return box;
}

export async function renderKakeibo(root: HTMLElement): Promise<void> {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const page = el('div', 'kk');
  root.appendChild(page);

  const status = el('span', 'kk-note', '');
  const monthSel = el('select', 'kk-in') as HTMLSelectElement;
  const summary = el('div', 'kk-card');
  const listBox = el('div', '');
  // 既知の費目・略名は表示中の全行から集め、プルダウンの候補にする
  let knownCategories: string[] = [];
  let knownAliases: string[] = [];
  // 費目タグのクリックで明細を絞り込む（もう一度押すと解除）
  let catFilter: string | null = null;
  // 明細の並び替え。既定は金額の降順（何に使ったかより、何が高かったかを先に見たい）。
  // ヘッダ1回目で降順、2回目で昇順。
  let sortKey: 'used_on' | 'shop' | 'amount' = 'amount';
  let sortAsc = false;

  const hd = el('div', 'kk-hd');
  hd.appendChild(el('h1', '', '家計簿'));
  const copyBtn = el('button', 'kk-btn', 'ブックマークレット');
  const copyMsg = el('span', 'kk-note', '');
  copyBtn.addEventListener('click', () => void (async () => {
    // 送信先は今見ているオリジンを埋め込むので、dev/stage/本番でそれぞれ正しいものが作られる
    const url = buildBookmarkletUrl(location.origin);
    try {
      await navigator.clipboard.writeText(url);
      copyMsg.className = 'kk-ok';
      copyMsg.textContent = 'コピー済';
    } catch {
      const ta = el('textarea', 'kk-in') as HTMLTextAreaElement;
      ta.value = url;
      ta.style.cssText = 'width:100%;height:70px;margin-top:6px;font:11px monospace';
      page.insertBefore(ta, page.children[1] ?? null);
      ta.select();
      copyMsg.className = 'kk-err';
      copyMsg.textContent = '手動でコピー';
    }
  })());
  const hdRight = el('div', 'kk-row');
  hdRight.append(copyMsg, copyBtn);
  hd.appendChild(hdRight);
  page.appendChild(hd);

  // 集計をトップにする。分類の目的は月をまたいだ比較なので、明細より先に見せる。
  const tabs = el('div', 'kk-tabs');
  const tabAgg = el('button', 'kk-tab on', '集計');
  const tabList = el('button', 'kk-tab', '明細');
  tabs.append(tabAgg, tabList);
  page.appendChild(tabs);

  const aggBox = el('div', '');
  const listView = el('div', '');
  listView.style.display = 'none';

  const bar = el('div', 'kk-row');
  const reloadBtn = el('button', 'kk-btn', '再読込');
  bar.append(monthSel, reloadBtn, status);
  listView.appendChild(bar);

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
    if (!months.length) { summary.textContent = '取り込みなし'; listBox.innerHTML = ''; }
  };

  const loadRows = async (): Promise<void> => {
    const bm = monthSel.value;
    if (!bm) return;
    const res = await api<{
      latestImport: { as_of?: string; captured_at?: string; rows_total?: number; row_count?: number } | null;
      rows: StatementRow[];
    }>(`/statements?billingMonth=${encodeURIComponent(bm)}`);

    knownCategories = [...new Set(res.rows.flatMap((r) => r.categories))].sort();
    knownAliases = [...new Set(res.rows.map((r) => r.shop_alias ?? '').filter(Boolean))].sort();

    const m = res.latestImport;
    summary.innerHTML = '';
    if (m) {
      const s = el('div', 'kk-row');
      s.appendChild(el('strong', '', `${m.row_count ?? res.rows.length}件 ${yen(m.rows_total ?? 0)}`));
      if (catFilter) s.appendChild(el('span', 'kk-note', `絞り込み: ${catFilter}（もう一度クリックで解除）`));
      // 「現在判明分」は確定前スナップショットの基準日。取り直す前提なので必ず見せる。
      s.appendChild(el('span', 'kk-sub',
        [m.as_of, m.captured_at?.slice(0, 16).replace('T', ' ')].filter(Boolean).join(' / ')));
      summary.appendChild(s);
      // 費目ごとの小計。分類の目的はこれなので、明細より先に出す。
      const byCat = new Map<string, number>();
      for (const r of res.rows) {
        for (const k of r.categories.length ? r.categories : ['未分類']) {
          byCat.set(k, (byCat.get(k) ?? 0) + r.amount_jpy);
        }
      }
      const cats = el('div', 'kk-row');
      cats.style.marginTop = '4px';
      for (const [k, v] of [...byCat].sort((a, b) => b[1] - a[1])) {
        // クリックでその費目だけに絞る。もう一度押すと解除。
        const t = el('span', 'kk-tag kk-clk' + (catFilter === k ? ' on' : ''), `${k} ${yen(v)}`);
        t.addEventListener('click', () => { catFilter = catFilter === k ? null : k; void loadRows(); });
        cats.appendChild(t);
      }
      summary.appendChild(cats);
    }

    const table = el('table', 'kk-tb');
    const head = el('tr');
    const cols: [string, 'used_on' | 'shop' | 'amount' | null][] = [
      ['日付', 'used_on'], ['店', 'shop'], ['費目', null], ['略名', null], ['金額', 'amount'],
    ];
    for (const [label, key] of cols) {
      if (!key) { head.appendChild(el('th', '', label)); continue; }
      const on = sortKey === key;
      const th = el('th', (key === 'amount' ? 'kk-num ' : '') + 'kk-clk' + (on ? ' kk-on' : ''),
        label + (on ? (sortAsc ? ' ▲' : ' ▼') : ''));
      th.addEventListener('click', () => {
        if (sortKey === key) sortAsc = !sortAsc;
        else { sortKey = key; sortAsc = false; }
        void loadRows();
      });
      head.appendChild(th);
    }
    table.appendChild(head);

    const saveShop = async (shopId: string, body: Record<string, unknown>): Promise<void> => {
      await api(`/shops/${encodeURIComponent(shopId)}`, { method: 'PUT', body: JSON.stringify(body) });
      await loadRows();
    };

    const cf = catFilter;
    const shown = (cf
      ? res.rows.filter((r) => (r.categories.length ? r.categories : ['未分類']).includes(cf))
      : [...res.rows]);
    shown.sort((a, b) => {
      const d = sortKey === 'amount'
        ? a.amount_jpy - b.amount_jpy
        : sortKey === 'shop'
          ? (a.shop_alias ?? a.shop).localeCompare(b.shop_alias ?? b.shop, 'ja')
          : a.used_on.localeCompare(b.used_on);
      return sortAsc ? d : -d;
    });
    for (const r of shown) {
      const tr = el('tr');
      tr.appendChild(el('td', '', r.used_on.slice(5)));

      const shopCell = el('td', 'kk-wrap');
      shopCell.appendChild(el('div', '', r.shop));
      if (r.remark) shopCell.appendChild(el('div', 'kk-sub', r.remark));
      if (r.is_foreign) shopCell.appendChild(el('div', 'kk-sub', `${r.foreign_amount} ${r.currency}`));
      tr.appendChild(shopCell);

      // 費目は Notion の select 列に近い1つのコントロール。店に紐づくので同じ店の全明細に効く。
      const catCell = el('td', '');
      catCell.appendChild(multiSelect({
        values: r.categories,
        placeholder: '費目',
        choices: () => knownCategories,
        onChange: (next) => void saveShop(r.shop_id, { categories: next }),
      }));
      tr.appendChild(catCell);

      const aliasCell = el('td', '');
      aliasCell.appendChild(combobox({
        placeholder: '略名', width: '90px', value: r.shop_alias ?? '',
        choices: () => knownAliases,
        onPick: (v) => void saveShop(r.shop_id, { alias: v }),
      }));
      tr.appendChild(aliasCell);

      tr.appendChild(el('td', 'kk-num', yen(r.amount_jpy)));
      table.appendChild(tr);
    }
    listBox.innerHTML = '';
    const sc = el('div', 'kk-scroll');
    sc.appendChild(table);
    listBox.appendChild(sc);
  };

  const reloadAll = (): void => void (async () => {
    await loadMonths();
    await loadRows();
    if (aggBox.style.display !== 'none') await renderSummary(aggBox).catch(() => {});
  })();

  listView.appendChild(renderCsvImport(status, reloadAll));
  listView.append(summary, listBox);
  page.append(aggBox, listView);

  const showTab = (agg: boolean): void => {
    tabAgg.className = 'kk-tab' + (agg ? ' on' : '');
    tabList.className = 'kk-tab' + (agg ? '' : ' on');
    aggBox.style.display = agg ? '' : 'none';
    listView.style.display = agg ? 'none' : '';
    if (agg) void renderSummary(aggBox).catch((e) => { aggBox.textContent = String(e); });
  };
  tabAgg.addEventListener('click', () => showTab(true));
  tabList.addEventListener('click', () => showTab(false));

  monthSel.addEventListener('change', () => void loadRows());
  reloadBtn.addEventListener('click', reloadAll);
  listenForImport(status, reloadAll);

  try {
    await loadMonths();
    await loadRows();
    await renderSummary(aggBox);
  } catch (e) {
    status.className = 'kk-err';
    status.textContent = String(e instanceof Error ? e.message : e);
  }
}
