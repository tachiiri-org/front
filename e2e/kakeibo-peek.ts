/**
 * 集計 API の要点だけ覗く。画面を見なくても月の一覧や予測の前提を確かめられる。
 * 使い方: npx tsx e2e/kakeibo-peek.ts [dev|stage|production]
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
  console.error(`認証状態がありません: ${STATE}`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ storageState: JSON.parse(readFileSync(STATE, 'utf-8')) });
const page = await ctx.newPage();
await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.kk', { timeout: 30000 });

const out = (await page.evaluate(`(async () => {
  const s = await (await fetch('/api/v1/kakeibo/summary')).json();
  const bySrc = {};
  for (const r of s.bySource || []) {
    bySrc[r.source] = bySrc[r.source] || {};
    bySrc[r.source][r.billing_month] = r.total;
  }
  return { months: s.months.slice(0, 4), maxUsedOn: s.maxUsedOn,
           fixedCategories: s.fixedCategories, fixedShops: (s.fixedShops || []).length,
           issuers: s.issuers, bySource: bySrc };
})()`)) as Record<string, unknown>;

console.log(JSON.stringify(out));
await browser.close();
