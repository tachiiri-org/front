import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const ENV = process.argv[2] ?? 'dev';
const PREFIX = ENV === 'production' ? '' : `${ENV}.`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ storageState: JSON.parse(readFileSync(`./e2e/.auth/${PREFIX}kakeibo-tachiiri-com.json`, 'utf-8')) });
const page = await ctx.newPage();
await page.goto(`https://${PREFIX}kakeibo.tachiiri.com/import`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.kk', { timeout: 30000 });
const out = await page.evaluate(`(async () => {
  const base = '/api/v1/kakeibo';
  const shops = (await (await fetch(base + '/shops')).json()).shops;
  const done = [];
  for (const s of shops) {
    if (!/モバイルＳｕｉｃａ定期/.test(s.name || '')) continue;
    const r = await fetch(base + '/shops/' + encodeURIComponent(s.shop_id), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixed: true, cycleMonths: 6 }) });
    done.push(s.name + ' (' + r.status + ')');
  }
  const after = (await (await fetch(base + '/shops')).json()).shops
    .filter(x => x.cycle_months).map(x => [x.name, x.cycle_months]);
  return { done, cycles: after };
})()`);
console.log(JSON.stringify(out));
await browser.close();
