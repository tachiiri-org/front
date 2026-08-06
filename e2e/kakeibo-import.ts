/**
 * 明細 CSV をファイルから取り込む。画面の取り込み口と同じ経路を通す。
 * 使い方: npx tsx e2e/kakeibo-import.ts [dev|stage|production] <CSVのパス>
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const ENV = process.argv[2] ?? 'dev';
const FILE = process.argv[3] ?? '';
const PREFIX = ENV === 'production' ? '' : `${ENV}.`;
const BASE = `https://${PREFIX}kakeibo.tachiiri.com`;
const STATE = path.join(path.dirname(fileURLToPath(import.meta.url)), `.auth/${PREFIX}kakeibo-tachiiri-com.json`);

if (!existsSync(STATE)) { console.error(`認証状態がありません: ${STATE}`); process.exit(1); }
if (!existsSync(FILE)) { console.error(`CSV がありません: ${FILE}`); process.exit(1); }

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ storageState: JSON.parse(readFileSync(STATE, 'utf-8')) });
const page = await ctx.newPage();
page.on('dialog', (d) => void d.dismiss());
await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.kk', { timeout: 30000 });

// 取り込み口は「明細」タブの中にある
await page.locator('.kk-tab', { hasText: '明細' }).first().click();
await page.waitForTimeout(500);
await page.setInputFiles('input[type=file]', FILE);
await page.waitForTimeout(1200);
const before = await page.locator('.kk').innerText();
const run = page.locator('button', { hasText: '取り込' }).first();
await run.click();
await page.waitForTimeout(4000);
console.log(await page.locator('.kk').innerText().then((t) => t.slice(0, 1200)));
void before;
await browser.close();
