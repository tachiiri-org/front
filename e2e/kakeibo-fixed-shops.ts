/**
 * 店に固定費の印を付ける。費目が固定費でなくても、その店だけ定額のことがある
 * （食費のうち定期便だけ、など）。着地予測で日割りするかを決める。
 *
 * 使い方: npx tsx e2e/kakeibo-fixed-shops.ts [dev|stage|production] [店名の一部,...]
 * 店名を省略すると現在の設定を出すだけで、書き込みはしない。
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const ENV = process.argv[2] ?? 'production';
const WANT = (process.argv[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
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

const out = (await page.evaluate(`(async () => {
  const want = ${JSON.stringify(WANT)};
  const base = '/api/v1/kakeibo';
  const shops = (await (await fetch(base + '/shops')).json()).shops;
  const hit = (s) => want.some((w) => (s.name || '').includes(w) || (s.alias || '').includes(w));
  const applied = [];
  if (want.length) {
    for (const s of shops) {
      const target = hit(s);
      if (target === !!s.fixed) continue;
      const r = await fetch(base + '/shops/' + encodeURIComponent(s.shop_id),
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fixed: target }) });
      applied.push((s.alias || s.name) + ' -> ' + target + ' (' + r.status + ')');
      await new Promise((res) => setTimeout(res, 300));
    }
  }
  const after = (await (await fetch(base + '/shops')).json()).shops;
  return { applied, fixed: after.filter((s) => s.fixed).map((s) => s.alias || s.name) };
})()`)) as { applied: string[]; fixed: string[] };

for (const line of out.applied) console.log('変更:', line);
console.log('固定費の店:', out.fixed.join(', ') || '（なし）');
await browser.close();
