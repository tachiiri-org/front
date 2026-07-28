// dev.uranai の正規 RP フローで認証してホイール図を撮る。
// dev.uranai → dev.authn ログインページ →「GitHub でログイン」→ github(既ログイン) → callback → uranai SPA。
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import * as OTPAuth from 'otpauth';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const AUTH = path.join(dir, '.auth/front-dev-tachiiri-workers-dev.json'); // github.com セッション流用
const BASE = 'https://dev.uranai.tachiiri.com';
const env = (k: string) => (process.env[k] ?? process.env[`${k} `] ?? '').trim();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: existsSync(AUTH) ? AUTH : undefined, viewport: { width: 1200, height: 860 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[perr]', m.text()); });

// github.com にログイン（storageState 切れ対策）
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
  console.log('[auth] github logged in');
} else console.log('[auth] github already logged in');

// RP フロー: dev.uranai → dev.authn ログインページ
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
console.log('[auth] login page url:', page.url());
const ghLogin = page.locator('button:has-text("Sign in with GitHub"), a:has-text("Sign in with GitHub"), button:has-text("GitHub でログイン")').first();
if (await ghLogin.isVisible({ timeout: 8000 }).catch(() => false)) {
  await ghLogin.click();
  console.log('[auth] clicked GitHub でログイン');
} else console.log('[auth] GitHub ログインボタン未検出 url=' + page.url());

// github authorize（既ログインなら自動 or Authorize）
await page.waitForTimeout(2500);
if (page.url().includes('github.com/login/oauth/authorize')) {
  await page.screenshot({ path: '/tmp/uranai-gh-authorize.png' });
  const btn = page.locator('button[name="authorize"][value="1"], button:has-text("Authorize"), input[type="submit"][value*="Authorize" i]').first();
  if (await btn.isVisible({ timeout: 6000 }).catch(() => false)) { await btn.click(); console.log('[auth] Authorize クリック'); }
  else console.log('[auth] authorize page だがボタン無し');
}

// dev.authn の組織選択ページ（select-org）で Authorize
await page.waitForTimeout(2500);
if (page.url().includes('/oauth/mcp/select-org')) {
  const orgAuth = page.locator('button:has-text("Authorize"), input[type="submit"][value*="Authorize" i]').first();
  if (await orgAuth.isVisible({ timeout: 6000 }).catch(() => false)) { await orgAuth.click(); console.log('[auth] 組織 Authorize クリック'); }
  else console.log('[auth] select-org だがボタン無し url=' + page.url());
}
// dev.uranai に戻るまで待つ
await page.waitForURL((u) => u.toString().startsWith(BASE), { timeout: 40000 }).catch(() => console.log('[auth] dev.uranai に戻らず'));
await page.waitForTimeout(2500);
console.log('[auth] final url:', page.url());
if (!page.url().startsWith(BASE)) { await page.screenshot({ path: '/tmp/uranai-auth-fail.png' }); console.log('!! 認証失敗'); await browser.close(); process.exit(2); }

// uranai フロー
const addBtn = page.locator('button:has-text("人物を追加")');
if (await addBtn.isVisible({ timeout: 8000 }).catch(() => false)) { await addBtn.click(); await page.waitForTimeout(800); }
else console.log('[uranai] 追加ボタン無し（画面未描画かも）url=' + page.url());
await page.fill('input[placeholder="表示名（例: 自分）"]', '自分').catch(() => {});
await page.fill('input[type="date"]', '1993-11-28').catch(() => {});
await page.fill('input[type="time"]', '07:30').catch(() => {});
const place = page.locator('input[placeholder="出生地を検索（例: 松本市）"]');
if (await place.isVisible({ timeout: 5000 }).catch(() => false)) {
  await place.fill('松本市'); await page.waitForTimeout(2200);
  const first = page.locator('.u-geo-item').first();
  if (await first.isVisible({ timeout: 6000 }).catch(() => false)) { await first.click(); console.log('[uranai] 地名選択'); }
  else console.log('!! 地名候補なし');
} else console.log('!! 出生フォーム未表示');
await page.fill('input[placeholder="UTCオフセット（例: +09:00）"]', '+09:00').catch(() => {});
await page.screenshot({ path: '/tmp/uranai-form.png' }); console.log('[uranai] saved /tmp/uranai-form.png');

const calc = page.locator('button:has-text("チャートを計算")');
if (await calc.isVisible({ timeout: 5000 }).catch(() => false)) {
  await calc.click();
  await page.waitForSelector('.u-chart svg', { timeout: 25000 }).catch(() => console.log('!! ホイール図未出現'));
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: '/tmp/uranai-chart.png' }); console.log('[uranai] saved /tmp/uranai-chart.png');
console.log('[uranai] counts:', await page.locator('.u-counts').textContent().catch(() => null));
console.log('[uranai] warn:', await page.locator('.u-warn').textContent().catch(() => null));
await browser.close();
