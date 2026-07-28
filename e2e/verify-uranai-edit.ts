// 既存人物を選択 →「✎ 出生データを編集」→ フォームが事前入力されていることを確認して撮影。
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import * as OTPAuth from 'otpauth';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const AUTH = path.join(dir, '.auth/front-dev-tachiiri-workers-dev.json');
const BASE = 'https://dev.uranai.tachiiri.com';
const env = (k: string) => (process.env[k] ?? process.env[`${k} `] ?? '').trim();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: existsSync(AUTH) ? AUTH : undefined, viewport: { width: 1200, height: 860 } });
const page = await ctx.newPage();

await page.goto('https://github.com/login', { waitUntil: 'domcontentloaded' });
if (await page.waitForSelector('#login_field', { timeout: 4000 }).catch(() => null)) {
  await page.fill('#login_field', env('GITHUB_EMAIL'));
  await page.fill('#password', env('GITHUB_PASSWORD'));
  await page.click('[name="commit"]');
  await page.waitForLoadState('domcontentloaded');
  if (page.url().includes('two-factor')) {
    const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(env('GITHUB_TOTP_SECRET')), digits: 6, period: 30 }).generate();
    await page.fill('#app_totp', code).catch(async () => { await page.fill('input[name="app_otp"]', code); });
    await page.keyboard.press('Enter'); await page.waitForLoadState('domcontentloaded');
  }
}

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
const gh = page.locator('button:has-text("Sign in with GitHub"), a:has-text("Sign in with GitHub")').first();
if (await gh.isVisible({ timeout: 8000 }).catch(() => false)) await gh.click();
await page.waitForTimeout(2500);
if (page.url().includes('github.com/login/oauth/authorize')) {
  const b = page.locator('button[name="authorize"][value="1"], button:has-text("Authorize")').first();
  if (await b.isVisible({ timeout: 6000 }).catch(() => false)) await b.click();
}
await page.waitForTimeout(2500);
if (page.url().includes('/oauth/mcp/select-org')) {
  const b = page.locator('button:has-text("Authorize")').first();
  if (await b.isVisible({ timeout: 6000 }).catch(() => false)) await b.click();
}
await page.waitForURL((u) => u.toString().startsWith(BASE), { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(2500);
console.log('[auth] final url:', page.url());

// チャートを持つ人物を探して選択（未計算の個体はスキップ）
await page.waitForSelector('.u-person', { timeout: 8000 });
const n = await page.locator('.u-person').count();
console.log('[edit] 人物数:', n);
const editBtn = page.locator('button:has-text("出生データを編集")');
let found = false;
for (let i = 0; i < n; i++) {
  const nameI = await page.locator('.u-person').nth(i).textContent().catch(() => '?');
  await page.locator('.u-person').nth(i).click();
  await page.waitForTimeout(2500);
  const hasChart = await page.locator('.u-chart svg').isVisible().catch(() => false);
  const title = await page.locator('.u-main .u-title').first().textContent().catch(() => '');
  console.log(`[edit] #${i} "${nameI}" chart=${hasChart} title="${title}"`);
  if (await editBtn.isVisible({ timeout: 12000 }).catch(() => false)) { console.log(`[edit] チャート持ちの人物 #${i} を選択`); found = true; break; }
}
if (!found) { console.log('!! 編集ボタンを持つ人物が見つからない'); await page.screenshot({ path: '/tmp/uranai-edit.png' }); await browser.close(); process.exit(2); }
await editBtn.click(); console.log('[edit] 編集ボタン click');

await page.waitForTimeout(1500);
// 事前入力の検証
const dateV = await page.locator('input[type="date"]').inputValue().catch(() => '');
const timeV = await page.locator('input[type="time"]').inputValue().catch(() => '');
const labelV = await page.locator('input[placeholder="表示名（例: 自分）"]').inputValue().catch(() => '');
const tzV = await page.locator('input[placeholder="UTCオフセット（例: +09:00）"]').inputValue().catch(() => '');
const picked = await page.locator('.u-picked').textContent().catch(() => '');
console.log('[edit] 事前入力:', JSON.stringify({ labelV, dateV, timeV, tzV, picked }));
await page.screenshot({ path: '/tmp/uranai-edit.png' });
console.log('[edit] saved /tmp/uranai-edit.png');
await browser.close();
