/**
 * 費目に固定費の印を付ける。着地予測で日割りするかどうかを決める属性。
 *
 * 使い方: npx tsx e2e/kakeibo-fixed-cats.ts [dev|stage|production] [費目,費目,...]
 * 費目を省略すると現在の設定を出すだけで、書き込みはしない。
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
  const before = (await (await fetch(base + '/categories')).json()).categories;
  const applied = [];
  for (const c of before) {
    const target = want.length ? want.includes(c.name) : !!c.fixed;
    if (want.length && target !== !!c.fixed) {
      const r = await fetch(base + '/categories/' + encodeURIComponent(c.name),
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fixed: target }) });
      applied.push(c.name + ' -> ' + target + ' (' + r.status + ')');
      await new Promise((res) => setTimeout(res, 300));
    }
  }
  const after = (await (await fetch(base + '/categories')).json()).categories;
  return { applied, fixed: after.filter((c) => c.fixed).map((c) => c.name),
           all: after.map((c) => c.name) };
})()`)) as { applied: string[]; fixed: string[]; all: string[] };

for (const line of out.applied) console.log('変更:', line);
console.log('固定費:', out.fixed.join(', ') || '（なし）');
console.log('全費目:', out.all.join(', '));
await browser.close();
