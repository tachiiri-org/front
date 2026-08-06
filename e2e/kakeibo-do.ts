/**
 * 家計簿の DO を R2 へ書き出す／戻す。ブラウザの認証状態を使って管理口を叩くだけ。
 *
 * 使い方:
 *   npx tsx e2e/kakeibo-do.ts production backup
 *   npx tsx e2e/kakeibo-do.ts dev restore <R2のキー>
 *
 * 本番を戻し先にはできない（バックエンド側が拒否する）。
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const ENV = process.argv[2] ?? 'dev';
const ACTION = process.argv[3] ?? 'backup';
const KEY = process.argv[4] ?? '';
const PREFIX = ENV === 'production' ? '' : `${ENV}.`;
const BASE = `https://${PREFIX}kakeibo.tachiiri.com`;
const STATE = path.join(path.dirname(fileURLToPath(import.meta.url)), `.auth/${PREFIX}kakeibo-tachiiri-com.json`);

if (!existsSync(STATE)) {
  console.error(`認証状態がありません。先に screenshot-kakeibo.ts を実行してください: ${STATE}`);
  process.exit(1);
}
if (ACTION === 'restore' && !KEY) {
  console.error('restore にはキーが要ります');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ storageState: JSON.parse(readFileSync(STATE, 'utf-8')) });
const page = await ctx.newPage();
await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.kk', { timeout: 30000 });

const suffix = ACTION === 'restore' ? `/restore-do?key=${encodeURIComponent(KEY)}` : '/backup-do';
const out = (await page.evaluate(`(async () => {
  const r = await fetch('/api/v1/kakeibo/admin' + ${JSON.stringify(suffix)}, { method: 'POST' });
  return { status: r.status, body: await r.text() };
})()`)) as { status: number; body: string };

console.log(out.status, out.body);
await browser.close();
process.exit(out.status === 200 ? 0 : 1);
