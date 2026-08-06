import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ storageState: JSON.parse(readFileSync('./e2e/.auth/kakeibo-tachiiri-com.json', 'utf-8')) });
const page = await ctx.newPage();
await page.goto('https://kakeibo.tachiiri.com/import', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.kk', { timeout: 30000 });
const out = await page.evaluate(`(async () => {
  const s = await (await fetch('/api/v1/kakeibo/summary')).json();
  const per = {};
  for (const r of s.byShop) {
    per[r.name] = per[r.name] || { total: 0, cat: r.category, label: r.label };
    per[r.name].total += r.total;
  }
  const med = /医院|クリニック|薬局|病院|歯科|皮膚|眼科|内科|外科|小児|整形|耳鼻|産婦|婦人|調剤|ドラッグ|薬|ヘルスケア|接骨|整骨|鍼|治療/;
  return Object.entries(per).filter(([n, v]) => med.test(n) || v.cat === '医療')
    .sort((a,b) => b[1].total - a[1].total)
    .map(([n, v]) => [n, v.cat, v.total]);
})()`);
for (const [n, c, t] of out as [string,string,number][]) console.log(String(t).padStart(8), (c||'').padEnd(6), n);
await browser.close();
