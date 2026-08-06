/**
 * 店に費目と略名を一括で付ける。規則は下の RULES に書く。
 * 使い方: npx tsx e2e/kakeibo-classify.ts [dev|stage|production] [--dry]
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const ENV = process.argv[2] ?? 'dev';
const DRY = process.argv.includes('--dry');
const PREFIX = ENV === 'production' ? '' : `${ENV}.`;
const BASE = `https://${PREFIX}kakeibo.tachiiri.com`;
const STATE = path.join(path.dirname(fileURLToPath(import.meta.url)), `.auth/${PREFIX}kakeibo-tachiiri-com.json`);
if (!existsSync(STATE)) { console.error(`認証状態がありません: ${STATE}`); process.exit(1); }

// 何か月ごとに立つか。定期券や年会費のように、前月・前々月を見ても周期が分からないもの。
const CYCLES: [string, number][] = [
  ['モバイルＳｕｉｃａ定期', 6],
  ['カード年会費', 12],
];

// 上から順に見て最初に当たった規則を使う。alias が null なら店名のまま。
const RULES: [string, string, string | null][] = [
  ['オート.{0,4}（モバイル）|モバイルＳｕｉｃａ入金', '交通費', 'Suicaチャージ'],
  ['モバイルＳｕｉｃａ定期', '交通費', 'Suica定期'],
  ['グリーン', '交通費', 'グリーン券'],
  ['サイクルンペディア', '交通費', '駐輪場'],
  ['マツモトキヨシ|ウェルパーク|無印良品', '日用品', null],
  ['医院|クリニック|薬局|病院|歯科|皮膚科|眼科|内科|外科|小児|整形|耳鼻|産婦|婦人科|調剤|医療センター', '医療費', null],
  ['セブン－イレブン小金井|マクドナルドモバイル', '外食', null],
  ['マルエツ', '食費', 'マルエツ'],
  ['明細書交付手数料', 'その他', '明細手数料'],
  ['カード年会費', 'その他', '年会費'],
];

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ storageState: JSON.parse(readFileSync(STATE, 'utf-8')) });
const page = await ctx.newPage();
await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.kk', { timeout: 30000 });

const out = (await page.evaluate(`(async () => {
  const rules = ${JSON.stringify(RULES)};
  const cycles = ${JSON.stringify(CYCLES)};
  const dry = ${DRY};
  const base = '/api/v1/kakeibo';
  const shops = (await (await fetch(base + '/shops')).json()).shops;
  const cur = {};
  for (const r of (await (await fetch(base + '/summary')).json()).byShop) cur[r.shop_id] = r.category;
  const done = [];
  for (const s of shops) {
    const cyc = cycles.find(([re]) => new RegExp(re).test(s.name || ''));
    if (cyc && s.cycle_months !== cyc[1]) {
      if (!dry) {
        await fetch(base + '/shops/' + encodeURIComponent(s.shop_id), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fixed: true, cycleMonths: cyc[1] }) });
        await new Promise((res) => setTimeout(res, 400));
      }
      done.push('周期 ' + cyc[1] + 'か月 / 固定費  ' + s.name);
    }
    const hit = rules.find(([re]) => new RegExp(re).test(s.name || ''));
    if (!hit) continue;
    const [, cat, alias] = hit;
    const wantAlias = alias === null ? (s.alias || null) : alias;
    if (cur[s.shop_id] === cat && (s.alias || null) === wantAlias) continue;
    const body = { categories: [cat] };
    if (alias !== null) body.alias = alias;
    let status = 'dry';
    if (!dry) {
      const r = await fetch(base + '/shops/' + encodeURIComponent(s.shop_id),
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      status = String(r.status);
      await new Promise((res) => setTimeout(res, 400));
    }
    done.push((cur[s.shop_id] || '未分類') + ' -> ' + cat + (alias ? ' / ' + alias : '') + '  ' + s.name + ' (' + status + ')');
  }
  return done;
})()`)) as string[];

console.log(out.length, '件', DRY ? '（変更なし・確認のみ）' : '');
for (const l of out) console.log(l);
await browser.close();
