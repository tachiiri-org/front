/**
 * 家計簿に登録されている店の一覧と、月ごとの利用額を集計して出す。
 * 費目・略名を検討するための材料。書き込みは一切しない。
 *
 * 使い方: npx tsx e2e/kakeibo-shops.ts [dev|stage|production]
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const ENV = process.argv[2] ?? 'production';
const PREFIX = ENV === 'production' ? '' : `${ENV}.`;
const BASE = `https://${PREFIX}kakeibo.tachiiri.com`;
const STATE = path.join(path.dirname(fileURLToPath(import.meta.url)), `.auth/${PREFIX}kakeibo-tachiiri-com.json`);

if (!existsSync(STATE)) {
  console.error(`認証状態がありません。先に screenshot-kakeibo.ts を実行してください: ${STATE}`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ storageState: JSON.parse(readFileSync(STATE, 'utf-8')) });
const page = await ctx.newPage();
await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.kk', { timeout: 30000 });

// tsx の変換が evaluate 内に helper を注入して壊れるので、文字列式で渡す
const data = (await page.evaluate(`(async () => {
  const get = async (p) => (await fetch('/api/v1/kakeibo' + p)).json();
  const { months } = await get('/months');
  const perShop = {};
  for (const m of months) {
    const res = await get('/statements?billingMonth=' + m);
    for (const r of res.rows) {
      const e = perShop[r.shop] || { total: 0, count: 0, months: [], remark: '', id: r.shop_id, cats: r.categories };
      e.total += r.amount_jpy;
      e.count += 1;
      if (!e.months.includes(m)) e.months.push(m);
      if (!e.remark && r.remark) e.remark = r.remark;
      perShop[r.shop] = e;
    }
  }
  return {
    months: months,
    shops: Object.keys(perShop).map(function (k) {
      const v = perShop[k];
      return { shop: k, id: v.id, total: v.total, count: v.count, months: v.months.length,
               remark: v.remark, cats: v.cats };
    }).sort(function (a, b) { return b.total - a.total; })
  };
})()`)) as {
  months: string[];
  shops: { shop: string; id: string; total: number; count: number; months: number; remark: string; cats: string[] }[];
};

console.log(`対象月: ${data.months.join(', ')}`);
console.log(`店舗数: ${data.shops.length}`);
console.log('---');
for (const s of data.shops) {
  console.log([s.shop, s.count, s.total, s.months, s.cats.join('|'), s.remark].join('\t'));
}
await browser.close();
