/**
 * GitHub Connect フローのデバッグ（拡張版）
 */
import { chromium } from '@playwright/test';
import * as OTPAuth from 'otpauth';
import { BASE_URL, TACHIIRI_ORG_ID } from './session.ts';

const CDP_PORT = 9222;
const GOOGLE_EMAIL = process.env.GOOGLE_EMAIL ?? '';
const GOOGLE_PASSWORD = process.env.GOOGLE_PASSWORD ?? '';
const GITHUB_TOTP_SECRET = process.env.GITHUB_TOTP_SECRET ?? '';

const generateTOTP = () => new OTPAuth.TOTP({
  secret: OTPAuth.Secret.fromBase32(GITHUB_TOTP_SECRET),
  digits: 6, period: 30,
}).generate();

const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

const ss = async (name: string) => {
  const p = `/tmp/gc-debug-${name}.png`;
  await page.screenshot({ path: p }).catch(() => {});
  console.log(`[ss] ${name}: ${page.url()}`);
};

// select-org → DB Apply
await page.goto(`${BASE_URL}/api/auth/select-org?org_id=${TACHIIRI_ORG_ID}`, { waitUntil: 'networkidle' });
await page.goto(`${BASE_URL}/DB%20Apply`, { waitUntil: 'networkidle' });

// GitHub Connect クリック
const link = page.locator('a:has-text("GitHub Connect")').first();
await link.click({ force: true });
await page.waitForLoadState('networkidle').catch(() => {});
await ss('3-after-gc-click');

// Google ボタン
const googleBtn = page.locator('a:has-text("Google"), button:has-text("Google")').first();
if (await googleBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
  await googleBtn.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await ss('4-after-google-click');
  console.log('url after google click:', page.url());
}

// Google アカウント選択
if (page.url().includes('accounts.google.com')) {
  console.log('[google] on accounts.google.com');
  // アカウント選択ボタンを探す
  const accountBtn = page.locator(`[data-email="${GOOGLE_EMAIL}"], li:has-text("${GOOGLE_EMAIL}")`).first();
  const hasAccount = await accountBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  console.log('account button visible:', hasAccount);

  if (hasAccount) {
    await accountBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await ss('5-after-account-select');
  } else {
    // メール入力
    const emailInput = await page.waitForSelector('input[type="email"]', { timeout: 5_000 }).catch(() => null);
    if (emailInput) {
      await page.fill('input[type="email"]', GOOGLE_EMAIL);
      await page.click('#identifierNext, button:has-text("次へ"), button:has-text("Next")');
      await page.waitForLoadState('networkidle').catch(() => {});
      await ss('5-after-email');
    }
    // パスワード入力
    const pwInput = await page.waitForSelector('input[type="password"]', { timeout: 5_000 }).catch(() => null);
    if (pwInput && GOOGLE_PASSWORD) {
      await page.fill('input[type="password"]', GOOGLE_PASSWORD);
      await page.click('#passwordNext, button:has-text("次へ"), button:has-text("Next")');
      await page.waitForLoadState('networkidle').catch(() => {});
      await ss('5b-after-password');
    }
  }
  console.log('url after google auth:', page.url());
  await ss('6-after-google-auth');
}

// GitHub 2FA
if (page.url().includes('github.com/sessions/two-factor')) {
  console.log('[github 2fa] on 2fa page');
  const moreOptions = page.locator('button:has-text("More options"), summary:has-text("More options")').first();
  if (await moreOptions.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await moreOptions.click();
    await page.waitForTimeout(300);
  }
  const code = generateTOTP();
  console.log(`TOTP: ${code}`);
  await page.fill('input[name="otp"], input[autocomplete="one-time-code"], input[type="text"]', code);
  await page.click('button[type="submit"], input[type="submit"]').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await ss('7-after-totp');
  console.log('url after 2fa:', page.url());
}

// 最終状態
console.log('final url:', page.url());
await ss('final');
// don't disconnect so browser stays alive
process.exit(0);
