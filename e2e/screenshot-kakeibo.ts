/**
 * 家計簿画面のスクリーンショットを撮る（ライト/ダーク両方）。
 *
 * 製品ホスト（kakeibo）は認証を authn に委譲するので、人間と同じ導線をなぞる。
 *   kakeibo/import → authn の認可画面 → Sign in with GitHub → kakeibo に戻る
 *
 * session.ts の getSession は使わない。あちらは GitHub 上で networkidle を待つが、
 * github.com は接続を保持し続けるので待ちきれずタイムアウトする。ここでは要素の出現で待つ。
 *
 * 使い方: npx tsx e2e/screenshot-kakeibo.ts [dev|stage|production]
 */
import './load-dev-vars.ts';
import { chromium, type Page } from '@playwright/test';
import * as OTPAuth from 'otpauth';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ENV = process.argv[2] ?? 'dev';
const PREFIX = ENV === 'production' ? '' : `${ENV}.`;
const KAKEIBO = `https://${PREFIX}kakeibo.tachiiri.com`;

const OUT = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(OUT, `.auth/${PREFIX}kakeibo-tachiiri-com.json`);
mkdirSync(path.dirname(STATE), { recursive: true });

const EMAIL = process.env.GITHUB_EMAIL ?? '';
const PASSWORD = process.env.GITHUB_PASSWORD ?? '';
const TOTP_SECRET = process.env.GITHUB_TOTP_SECRET ?? '';

const totp = (): string =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(TOTP_SECRET), digits: 6, period: 30 }).generate();

/** 認可画面が出ていたら GitHub でログインして通す。既に通っていれば何もしない。 */
async function passAuth(page: Page): Promise<void> {
  for (let i = 0; i < 10; i++) {
    if (await page.locator('.kk').count()) return;

    // authn の認可画面
    const btn = page.locator('a.btn.github, a:has-text("Sign in with GitHub")').first();
    if (await btn.count()) {
      await btn.click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2500);
      continue;
    }

    // GitHub のログインフォーム
    if (await page.locator('#login_field').count()) {
      if (!EMAIL || !PASSWORD) throw new Error('GITHUB_EMAIL / GITHUB_PASSWORD が未設定です');
      await page.fill('#login_field', EMAIL);
      await page.fill('#password', PASSWORD);
      await page.click('[name="commit"]');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);
      continue;
    }

    // GitHub の 2FA。既定はセキュリティキー(webauthn)なので、認証アプリ側へ切り替える。
    if (page.url().includes('/two-factor')) {
      if (!TOTP_SECRET) throw new Error('GITHUB_TOTP_SECRET が未設定です');
      const otp = page.locator('#app_totp, input[name="app_otp"]').first();
      if (!(await otp.count())) {
        const more = page.locator('button:has-text("More options"), summary:has-text("More options")').first();
        if (await more.count()) { await more.click().catch(() => {}); await page.waitForTimeout(600); }
        const appLink = page.locator('a[href*="/two-factor/app"], a:has-text("Authenticator app")').first();
        if (await appLink.count()) {
          await appLink.click();
          await page.waitForLoadState('domcontentloaded');
        } else {
          await page.goto('https://github.com/sessions/two-factor/app', { waitUntil: 'domcontentloaded' });
        }
        await page.waitForTimeout(1500);
        continue;
      }
      await otp.fill(totp());
      await page.waitForTimeout(5000);
      continue;
    }

    // authn の組織選択（初回のみ出る）。先頭の組織で進める。
    const orgSel = page.locator('select[name="group_id"]').first();
    if (await orgSel.count()) {
      const first = await orgSel.locator('option').first().getAttribute('value');
      if (first) await orgSel.selectOption(first);
      await page.locator('form[action="/oauth/mcp/approve"] button, button[type=submit]').first().click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);
      continue;
    }

    // OAuth の認可確認
    const authorize = page.locator('button[name="authorize"], input[name="authorize"]').first();
    if (await authorize.count()) {
      await authorize.click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2500);
      continue;
    }

    await page.waitForTimeout(2500);
  }
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const storageState = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf-8')) : undefined;

// 認証は一度だけ通し、その状態を両方の配色で使い回す
const warm = await browser.newContext({ storageState, viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
const warmPage = await warm.newPage();
await warmPage.goto(`${KAKEIBO}/import`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await warmPage.waitForTimeout(3000);
await passAuth(warmPage);
const state = await warm.storageState();
writeFileSync(STATE, JSON.stringify(state, null, 2));
console.log('[auth] 完了 url=', warmPage.url());
await warm.close();

for (const scheme of ['light', 'dark'] as const) {
  const ctx = await browser.newContext({
    storageState: state, viewport: { width: 1400, height: 900 }, locale: 'ja-JP', colorScheme: scheme,
  });
  const page = await ctx.newPage();
  // デプロイ直後は古いバンドルを掴むことがあるのでキャッシュを使わせない
  await page.route('**/*', (route) => route.continue({ headers: { ...route.request().headers(), 'Cache-Control': 'no-cache' } }));
  const errs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 160)));

  await page.goto(`${KAKEIBO}/import`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.kk', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    const k = document.querySelector('.kk');
    if (!k) return null;
    const r = k.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(window.innerWidth - r.right),
      bg: getComputedStyle(k).backgroundColor,
      rows: document.querySelectorAll('.kk-tb tr').length,
    };
  });
  console.log(`[${scheme}] url=${page.url()}`);
  console.log(`[${scheme}] ${info ? JSON.stringify(info) : '家計簿画面なし（未認証の可能性）'}`);
  if (errs.length) console.log(`[${scheme}] consoleエラー:`, errs);

  const file = path.join(OUT, `kakeibo-${ENV}-${scheme}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[${scheme}] saved ${file}`);
  await ctx.close();
}

await browser.close();
