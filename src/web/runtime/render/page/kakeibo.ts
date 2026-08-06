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
  --ok:#4ade80;--err:#f87171;--accent:#60a5fa;--menu:#2a2b2e;--hover:rgba(255,255,255,.08);--sumbg:rgba(255,255,255,.06)`;
const LIGHT = `--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e2e2e2;--line2:#c8c8c8;
  --card:#fafafa;--field:#fff;--ok:#1e7a3c;--err:#c0392b;--accent:#2563eb;
  --menu:#fff;--hover:#f0f0f0;--sumbg:rgba(0,0,0,.045)`;

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
.kk-tb th{text-align:left;border-bottom:1px solid var(--line2);padding:5px 4px;
  font-weight:600;color:var(--muted);font-size:12px}
/* 月・合計の見出し。.kk-tb th の text-align:left が .kk-num より特異性で勝つため、
   金額列の見出しだけ左寄せのまま残っていた。中央に寄せて列の位置を示す。 */
.kk-tb th.kk-num{text-align:center}
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
.kk-edit{cursor:pointer;border-radius:4px}
.kk-edit:hover{background:var(--hover);outline:1px solid var(--line2)}
.kk-cell-in{width:90px;text-align:right;padding:2px 4px;border:1px solid var(--accent);
  border-radius:4px;background:var(--field);color:var(--fg);font:inherit;font-size:13px}
.kk-ov{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.6);
  display:flex;align-items:center;justify-content:center;padding:16px;
  width:auto;min-height:0}
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
.kk-tb tr.kk-sum td{border-top:1px solid var(--line2);font-weight:600;background:var(--sumbg)}
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
  maxUsedOn: string;
  byCategory: { billing_month: string; category: string; total: number; cnt: number }[];
  byShop: { billing_month: string; shop_id: string; label: string; name: string; category: string; total: number; cnt: number }[];
  income: { billing_month: string; label: string; total: number }[];
  bySource: { source: string; billing_month: string; total: number }[];
  fixedCategories: string[];
  multiCategoryShops: number;
};

/**
 * 集計ビュー。費目×月のマトリクスと、略名別の合計を出す。
 * 略名をクリックするとその店の明細を月を跨いで表示する。
 */
async function renderSummary(host: HTMLElement): Promise<void> {
  const redraw = (): void => void renderSummary(host);
  // 取得を終えてから消す。先に消すと通信のあいだ画面が空になり、失敗すると空のまま残る。
  const [s, fx] = await Promise.all([api<Summary>('/summary'), api<FixedData>('/fixed')]);
  host.innerHTML = '';
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
  // 最新の月が今月なら途中とみなし、その1つ前を並び替えの基準にする
  const nowD = new Date();
  const curM = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
  const defaultSortIndex = months[0] === curM && months.length > 1 ? 1 : 0;

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

    // 既定は最新の確定月。-1 は合計列。途中の月は金額が小さく出るので基準にしない。
    let sortAt = defaultSortIndex;
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
        for (const v of r.vals) tr.appendChild(el('td', 'kk-num', yen(v)));
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
  // 収支のカード。振込・引落・費目の3表を1枚にまとめ、最後に収支を出す。
  // 費目には引落の分も含まれる（費目は用途の分類、引落は支払い経路）。収支は 収入 − 費目計。
  {
    const now = new Date();
    const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    // 最新の月が今月なら途中とみなし、最終利用日を月の日数で割り返して着地を予測する。
    const inProgress = months[0] === curMonth && s.maxUsedOn.slice(0, 7) === curMonth;
    const lastDay = inProgress ? Number(s.maxUsedOn.slice(8, 10)) : 0;
    const daysInMonth = inProgress
      ? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      : 0;
    const factor = inProgress && lastDay > 0 ? daysInMonth / lastDay : 1;
    // 並び替えの既定は「最新の確定月」。途中の月は金額が小さく出るので基準にしない。
    const fixedIdx = inProgress ? 1 : 0;

    /**
     * 固定費の費目の着地予測。
     *
     * 日割りしない。通信費もサブスクも、月のどこで引き落ちても月額は変わらないので、
     * 経過日数で割り返すと月初は何倍にも膨らむ。代わりに、まだ明細が立っていない分を
     * 過去の実績から補う。
     *
     * 費目ではなく店ごとに見る。NHK は隔月、水道局はその逆位相、東京ガスは毎月と、
     * 同じ「公共料金」でも周期が違うため。判定は前月・前々月の有無だけで行う。
     *   前月あり・前々月あり → 毎月     → 前月の額
     *   前月なし・前々月あり → 隔月の当番 → 前々月の額
     *   前月あり・前々月なし → 隔月の休み、または始めたばかり → 0
     *   どちらも無し        → やめた    → 0
     * 「前月にあれば入れる」だけだと NHK が毎月になり、隔月を取りこぼす。
     * 3 番目を 0 にするのは控えめな側への誤りで、解約を引きずるより good。
     */
    const fixedCats = new Set(s.fixedCategories ?? []);
    // 費目 → 店 → 月 → 額
    const byCatShop = new Map<string, Map<string, Map<string, number>>>();
    for (const r of s.byShop) {
      let shops = byCatShop.get(r.category);
      if (!shops) { shops = new Map(); byCatShop.set(r.category, shops); }
      let mm = shops.get(r.shop_id);
      if (!mm) { mm = new Map(); shops.set(r.shop_id, mm); }
      mm.set(r.billing_month, (mm.get(r.billing_month) ?? 0) + r.total);
    }
    const projFixedCat = (cat: string): number => {
      const [m0, m1, m2] = months;
      let sum = 0;
      for (const mm of byCatShop.get(cat)?.values() ?? []) {
        const a0 = mm.get(m0) ?? 0;
        if (a0 > 0) { sum += a0; continue; }   // 今月ぶんが既に立っている
        const a1 = mm.get(m1) ?? 0;
        const a2 = mm.get(m2) ?? 0;
        if (a1 > 0 && a2 > 0) sum += a1;
        else if (a1 === 0 && a2 > 0) sum += a2;
      }
      return sum;
    };

    const cardAt = new Map<string, number>();
    for (const r of s.bySource ?? []) {
      if (r.source === 'ヨドバシカード') cardAt.set(r.billing_month, r.total);
    }
    const ovr = new Map<string, { id: string; amount: number }>();
    for (const e of fx.entries) {
      if (e.override_of) ovr.set(`${e.override_of}\u0001${e.occurred_month}`, { id: e.entry_id, amount: e.amount_jpy });
    }
    const inRange = (r: FixedData['recurring'][number], m: string): boolean =>
      m >= r.start_month && (!r.end_month || m <= r.end_month);
    // 引落の各月・費目ごとの額。着地予測ではカード分だけを割り返し、固定額はそのまま足す。
    const fixedByCat = new Map<string, number>();
    const effOf = (r: FixedData['recurring'][number], m: string): number => {
      const o = ovr.get(`${r.recurring_id}\u0001${m}`);
      return o ? o.amount : (inRange(r, m) ? r.amount_jpy : 0);
    };
    for (const r of fx.recurring.filter((x) => x.kind === 'expense')) {
      for (const m of months) fixedByCat.set(`${r.category ?? '未分類'}\u0001${m}`,
        (fixedByCat.get(`${r.category ?? '未分類'}\u0001${m}`) ?? 0) + effOf(r, m));
    }
    for (const e of fx.entries.filter((x) => x.kind === 'expense' && !x.override_of)) {
      const k = `${e.category ?? '未分類'}\u0001${e.occurred_month}`;
      fixedByCat.set(k, (fixedByCat.get(k) ?? 0) + e.amount_jpy);
    }

    const box = el('div', 'kk-card');
    const hd = el('div', 'kk-row');
    hd.appendChild(el('span', 'kk-note', '収支（引落・振込の金額はクリックで修正）'));
    if (inProgress) {
      hd.appendChild(el('span', 'kk-sub',
        `${curMonth} は ${s.maxUsedOn} まで。「予測」列は変動費を残り日数ぶん割り返し、固定費は過去の実績から補った着地見込みです`));
    }
    box.appendChild(hd);

    let sortAt = fixedIdx;
    const scroll = el('div', 'kk-scroll');
    box.appendChild(scroll);

    type SRow = { key: string; sub: string; vals: number[]; total: number;
      edit?: { rec: FixedData['recurring'][number] } };

    const draw = (): void => {
      scroll.innerHTML = '';
      const t = el('table', 'kk-tb');

      // ヘッダは表全体で1つ。節ごとに繰り返すと縦に間延びして読みにくい。
      const h = el('tr');
      h.appendChild(el('th', '', ''));
      if (inProgress) h.appendChild(el('th', 'kk-num', '予測'));
      months.forEach((m, i) => {
        const th = el('th', 'kk-num kk-clk' + (sortAt === i ? ' kk-on' : ''),
          m.slice(2) + (sortAt === i ? ' ▼' : ''));
        th.addEventListener('click', () => { sortAt = i; draw(); });
        h.appendChild(th);
      });
      const ht = el('th', 'kk-num kk-clk' + (sortAt === -1 ? ' kk-on' : ''),
        '合計' + (sortAt === -1 ? ' ▼' : ''));
      ht.addEventListener('click', () => { sortAt = -1; draw(); });
      h.appendChild(ht);
      t.appendChild(h);

      // 変動費の着地。経過日数で割り返す。
      const proj = (base: number): number => Math.round(base * factor);

      const totalRow = (label: string, vals: number[], projVal: number | null,
        emphasise: boolean): HTMLTableRowElement => {
        const tr = el('tr', 'kk-sum');
        tr.appendChild(el('td', '', label));
        if (inProgress) tr.appendChild(el('td', 'kk-num kk-sub', projVal === null ? '' : yen(projVal)));
        for (const v of vals) {
          const td = el('td', 'kk-num', yen(v));
          if (emphasise && v < 0) td.style.color = 'var(--err)';
          tr.appendChild(td);
        }
        const tot = vals.reduce((a, b) => a + b, 0);
        const tdT = el('td', 'kk-num', yen(tot));
        if (emphasise && tot < 0) tdT.style.color = 'var(--err)';
        tr.appendChild(tdT);
        return tr;
      };

      const itemRows = (rows: SRow[], projOf: (r: SRow) => number): void => {
        const sorted = [...rows].sort((a, b) =>
          sortAt === -1 ? b.total - a.total : (b.vals[sortAt] ?? 0) - (a.vals[sortAt] ?? 0));
        for (const r of sorted) {
          const tr = el('tr');
          tr.appendChild(el('td', '', r.key));
          if (inProgress) tr.appendChild(el('td', 'kk-num kk-sub', yen(projOf(r))));
          months.forEach((m, i) => {
            const v = r.vals[i] ?? 0;
            if (!r.edit) { tr.appendChild(el('td', 'kk-num', yen(v))); return; }
            const rec = r.edit.rec;
            const o = ovr.get(`${rec.recurring_id}\u0001${m}`);
            const td = el('td', 'kk-num kk-edit', yen(v));
            if (o) td.style.color = 'var(--accent)';
            td.title = o ? 'この月は上書き済み。空にすると既定額に戻ります' : 'クリックでこの月だけ変更';
            td.addEventListener('click', () => {
              const inp = el('input', 'kk-cell-in') as HTMLInputElement;
              inp.type = 'number';
              inp.value = String(v || '');
              td.textContent = '';
              td.appendChild(inp);
              inp.focus(); inp.select();
              let done = false;
              const commit = (): void => void (async () => {
                if (done) return;
                done = true;
                const nv = inp.value.trim();
                if (nv === '' && o) {
                  await api(`/fixed/entry/${encodeURIComponent(o.id)}`, { method: 'DELETE' });
                } else if (nv !== '' && Number(nv) !== v) {
                  await api('/fixed/entry', { method: 'POST', body: JSON.stringify({
                    kind: rec.kind, label: rec.label, amount: Number(nv), occurredMonth: m,
                    overrideOf: rec.recurring_id, categories: rec.category ? [rec.category] : [],
                  }) });
                }
                redraw();
              })();
              inp.addEventListener('blur', commit);
              inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
                if (e.key === 'Escape') { e.preventDefault(); done = true; redraw(); }
              });
            });
            tr.appendChild(td);
          });
          tr.appendChild(el('td', 'kk-num', yen(r.total)));
          t.appendChild(tr);
        }
      };

      const recRows = (kind: 'income' | 'expense'): SRow[] => [
        ...fx.recurring.filter((r) => r.kind === kind).map((r) => {
          const vals = months.map((m) => effOf(r, m));
          return { key: r.label, sub: r.category ?? '', vals,
            total: vals.reduce((a, b) => a + b, 0), edit: { rec: r } };
        }),
        ...fx.entries.filter((e) => e.kind === kind && !e.override_of).map((e) => {
          const vals = months.map((m) => (e.occurred_month === m ? e.amount_jpy : 0));
          return { key: e.label, sub: e.category ?? '', vals, total: e.amount_jpy };
        }),
      ];

      const incs = recRows('income');
      const debits = recRows('expense');
      const sumOf = (rows: SRow[]): number[] => months.map((_, i) => rows.reduce((a, r) => a + (r.vals[i] ?? 0), 0));
      const incTotals = sumOf(incs);
      const debTotals = sumOf(debits);
      const cardTotals = months.map((m) => cardAt.get(m) ?? 0);

      // 費目ごとの着地予測。固定費は日割りせず過去から補い、それ以外だけを割り返す。
      // カードの予測は費目の予測の合計にする（表に出ている行と足し算が合うように）。
      const catProjOf = (r: SRow): number =>
        fixedCats.has(r.key) ? projFixedCat(r.key) : proj(r.vals[0] ?? 0);
      const cardProj = catRows.reduce(
        (a, r) => a + catProjOf({ key: r.key, sub: '', vals: r.vals, total: r.total }), 0);
      const asIs = (r: SRow): number => r.vals[0] ?? 0;

      // 合計は各節の先頭に置く。まず結果、次に内訳という順で読める。
      t.appendChild(totalRow('収支',
        months.map((_, i) => incTotals[i] - debTotals[i] - cardTotals[i]),
        inProgress ? incTotals[0] - debTotals[0] - cardProj : null, true));

      t.appendChild(totalRow('振込', incTotals, inProgress ? incTotals[0] : null, false));
      itemRows(incs, asIs);

      t.appendChild(totalRow('引落', debTotals, inProgress ? debTotals[0] : null, false));
      itemRows(debits, asIs);

      t.appendChild(totalRow('ヨドバシ', cardTotals, inProgress ? cardProj : null, false));
      itemRows(catRows.map((r) => ({ key: r.key, sub: '', vals: r.vals, total: r.total })), catProjOf);

      scroll.appendChild(t);
    };
    draw();
    host.appendChild(box);
  }

  // 略名 × 月（費目つき・費目で絞り込める）
  const shopAt = new Map<string, number>();
  const shopId = new Map<string, string>();
  const shopCat = new Map<string, string>();
  const knownCats = [...new Set(s.byCategory.map((r) => r.category))].filter((c) => c !== '未分類').sort();
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
    // body 直下に出すため、CSS 変数を定義している .kk を併記して継承させる
    const overlay = el('div', 'kk kk-ov');
    const pop = el('div', 'kk-pop');
    const hd = el('div', 'kk-pop-hd');
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') dismiss(); };
    const dismiss = (): void => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const left = el('div', 'kk-row');
    left.appendChild(el('strong', '',
      `${label}　${res.rows.length}件　${yen(res.rows.reduce((a, r) => a + r.amount_jpy, 0))}`));
    // ここで費目を直せる。集計を見て気づいた分類ミスを、明細を確かめながら直せるようにする。
    const cur = shopCat.get(label);
    left.appendChild(multiSelect({
      values: cur && cur !== '未分類' ? [cur] : [],
      placeholder: '費目',
      choices: () => knownCats,
      onChange: (next) => void (async () => {
        await api(`/shops/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ categories: next }) });
        dismiss();
        redraw();
      })(),
    }));
    hd.appendChild(left);
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


type FixedData = {
  recurring: { recurring_id: string; kind: string; label: string; amount_jpy: number;
    start_month: string; end_month: string | null; category: string | null }[];
  entries: { entry_id: string; kind: string; label: string; occurred_month: string;
    amount_jpy: number; note: string | null; category: string | null; override_of: string | null }[];
};

/**
 * 口座引落の固定費と収入の入力。カード明細とは別勘定なので、取り込みでは触らない。
 *  - 毎月定額（家賃）は定義を1つ置き、期間内の各月へ自動で計上する
 *  - 金額が毎回違うもの（学費・固定資産税）と収入は、都度1件ずつ記録する
 */
async function renderFixed(host: HTMLElement, kind: 'expense' | 'income'): Promise<void> {
  host.innerHTML = '';
  const d = await api<FixedData>('/fixed');
  const reload = (): void => void renderFixed(host, kind);
  const rec = d.recurring.filter((r) => r.kind === kind);
  const ent = d.entries.filter((e) => e.kind === kind);
  const word = kind === 'income' ? '振込' : '引落';

  const field = (ph: string, w = '110px', type = 'text'): HTMLInputElement => {
    const i = el('input', 'kk-in') as HTMLInputElement;
    i.placeholder = ph;
    i.style.width = w;
    i.type = type;
    return i;
  };

  // ── 毎月定額
  const recBox = el('div', 'kk-card');
  recBox.appendChild(el('div', 'kk-note',
    `毎月定額 — 期間内の各月に自動で計上されます。特定の月だけ違う額なら「この月だけ変更」で上書きできます。`));
  const rt = el('table', 'kk-tb');
  const rh = el('tr');
  for (const x of ['名称', '費目', '金額', '開始', '終了', '']) rh.appendChild(el('th', '', x));
  rt.appendChild(rh);
  for (const r of rec) {
    const tr = el('tr');
    tr.appendChild(el('td', '', r.label));
    tr.appendChild(el('td', 'kk-sub', r.category ?? ''));
    tr.appendChild(el('td', 'kk-num', yen(r.amount_jpy)));
    tr.appendChild(el('td', '', r.start_month));
    tr.appendChild(el('td', '', r.end_month ?? '継続中'));
    const act = el('td', '');
    const ov = el('button', 'kk-btn', 'この月だけ変更');
    ov.addEventListener('click', () => {
      // 定義はそのままに、指定月だけ別額を記録する。集計ではその月の定義展開を止める。
      const m = field('YYYY-MM', '96px');
      const a = field('金額', '90px', 'number');
      const go = el('button', 'kk-btn', '保存');
      go.addEventListener('click', () => void (async () => {
        if (!/^\d{4}-\d{2}$/.test(m.value) || !a.value) { go.textContent = '入力不足'; return; }
        await api('/fixed/entry', { method: 'POST', body: JSON.stringify({
          kind, label: r.label, amount: Number(a.value), occurredMonth: m.value,
          overrideOf: r.recurring_id,
          categories: r.category ? [r.category] : [],
        }) });
        reload();
      })());
      act.innerHTML = '';
      act.append(m, a, go);
    });
    const del = el('button', 'kk-btn', '削除');
    del.addEventListener('click', () => void (async () => {
      await api(`/fixed/recurring/${encodeURIComponent(r.recurring_id)}`, { method: 'DELETE' });
      reload();
    })());
    act.append(ov, del);
    tr.appendChild(act);
    rt.appendChild(tr);
  }
  const rsc = el('div', 'kk-scroll');
  rsc.appendChild(rt);
  recBox.appendChild(rsc);

  const rf = el('div', 'kk-row');
  rf.style.marginTop = '8px';
  const rl = field('名称'); const rc = field('費目', '90px');
  const ra = field('金額', '90px', 'number'); const rs = field('開始 YYYY-MM', '110px');
  const re = field('終了（空で継続）', '130px');
  const radd = el('button', 'kk-btn', '追加');
  radd.addEventListener('click', () => void (async () => {
    if (!rl.value.trim() || !ra.value || !/^\d{4}-\d{2}$/.test(rs.value)) { radd.textContent = '入力不足'; return; }
    await api('/fixed/recurring', { method: 'POST', body: JSON.stringify({
      kind, label: rl.value.trim(), amount: Number(ra.value),
      startMonth: rs.value, endMonth: re.value || null,
      categories: rc.value.split(',').map((x) => x.trim()).filter(Boolean),
    }) });
    reload();
  })());
  rf.append(rl, rc, ra, rs, re, radd);
  recBox.appendChild(rf);
  host.appendChild(recBox);

  // ── 都度
  const entBox = el('div', 'kk-card');
  entBox.appendChild(el('div', 'kk-note', `都度 — 金額が毎回違う${word}`));
  const et = el('table', 'kk-tb');
  const eh = el('tr');
  for (const x of ['名称', '費目', '月', '金額', 'メモ', '']) eh.appendChild(el('th', '', x));
  et.appendChild(eh);
  for (const e of ent) {
    const tr = el('tr');
    const nm = el('td', '', e.label);
    if (e.override_of) nm.appendChild(el('div', 'kk-sub', '毎月定額の上書き'));
    tr.appendChild(nm);
    tr.appendChild(el('td', 'kk-sub', e.category ?? ''));
    tr.appendChild(el('td', '', e.occurred_month));
    tr.appendChild(el('td', 'kk-num', yen(e.amount_jpy)));
    tr.appendChild(el('td', 'kk-sub', e.note ?? ''));
    const del = el('button', 'kk-btn', '削除');
    del.addEventListener('click', () => void (async () => {
      await api(`/fixed/entry/${encodeURIComponent(e.entry_id)}`, { method: 'DELETE' });
      reload();
    })());
    const td = el('td', '');
    td.appendChild(del);
    tr.appendChild(td);
    et.appendChild(tr);
  }
  const esc = el('div', 'kk-scroll');
  esc.appendChild(et);
  entBox.appendChild(esc);

  const ef = el('div', 'kk-row');
  ef.style.marginTop = '8px';
  const el2 = field('名称'); const ec = field('費目', '90px');
  const em = field('月 YYYY-MM', '110px'); const ea = field('金額', '90px', 'number');
  const en = field('メモ', '120px');
  const eadd = el('button', 'kk-btn', '追加');
  eadd.addEventListener('click', () => void (async () => {
    if (!el2.value.trim() || !ea.value || !/^\d{4}-\d{2}$/.test(em.value)) { eadd.textContent = '入力不足'; return; }
    await api('/fixed/entry', { method: 'POST', body: JSON.stringify({
      kind, label: el2.value.trim(), amount: Number(ea.value),
      occurredMonth: em.value, note: en.value || null,
      categories: ec.value.split(',').map((x) => x.trim()).filter(Boolean),
    }) });
    reload();
  })());
  ef.append(el2, ec, em, ea, en, eadd);
  entBox.appendChild(ef);
  host.appendChild(entBox);
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
  const tabDebit = el('button', 'kk-tab', '引落');
  const tabIncome = el('button', 'kk-tab', '振込');
  tabs.append(tabAgg, tabList, tabDebit, tabIncome);
  page.appendChild(tabs);

  const aggBox = el('div', '');
  const listView = el('div', '');
  listView.style.display = 'none';
  const debitView = el('div', '');
  debitView.style.display = 'none';
  const incomeView = el('div', '');
  incomeView.style.display = 'none';

  const bar = el('div', 'kk-row');
  const reloadBtn = el('button', 'kk-btn', '再読込');
  bar.append(el('span', 'kk-note', '利用月'), monthSel, reloadBtn, status);
  listView.appendChild(bar);

  const loadMonths = async (): Promise<void> => {
    // 集計と同じ「利用月」で揃える。請求月のままだと 2026-07 を選んだのに6月の利用が出て、
    // 集計の列とも食い違っていた。
    const { usedMonths } = await api<{ months: string[]; usedMonths: string[] }>('/months');
    const months = usedMonths;
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
    }>(`/statements?usedMonth=${encodeURIComponent(bm)}`);

    knownCategories = [...new Set(res.rows.flatMap((r) => r.categories))].sort();
    knownAliases = [...new Set(res.rows.map((r) => r.shop_alias ?? '').filter(Boolean))].sort();

    summary.innerHTML = '';
    {
      const s = el('div', 'kk-row');
      s.appendChild(el('strong', '',
        `${res.rows.length}件 ${yen(res.rows.reduce((a, r) => a + r.amount_jpy, 0))}`));
      if (catFilter) s.appendChild(el('span', 'kk-note', `絞り込み: ${catFilter}（もう一度クリックで解除）`));
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
  page.append(aggBox, listView, debitView, incomeView);

  const showTab = (which: 'agg' | 'list' | 'debit' | 'income'): void => {
    tabAgg.className = 'kk-tab' + (which === 'agg' ? ' on' : '');
    tabList.className = 'kk-tab' + (which === 'list' ? ' on' : '');
    tabDebit.className = 'kk-tab' + (which === 'debit' ? ' on' : '');
    tabIncome.className = 'kk-tab' + (which === 'income' ? ' on' : '');
    aggBox.style.display = which === 'agg' ? '' : 'none';
    listView.style.display = which === 'list' ? '' : 'none';
    debitView.style.display = which === 'debit' ? '' : 'none';
    incomeView.style.display = which === 'income' ? '' : 'none';
    if (which === 'agg') void renderSummary(aggBox).catch((e) => { aggBox.textContent = String(e); });
    if (which === 'debit') void renderFixed(debitView, 'expense').catch((e) => { debitView.textContent = String(e); });
    if (which === 'income') void renderFixed(incomeView, 'income').catch((e) => { incomeView.textContent = String(e); });
  };
  tabAgg.addEventListener('click', () => showTab('agg'));
  tabList.addEventListener('click', () => showTab('list'));
  tabDebit.addEventListener('click', () => showTab('debit'));
  tabIncome.addEventListener('click', () => showTab('income'));

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
