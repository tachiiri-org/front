import { chromium, type Browser } from '@playwright/test';
import * as OTPAuth from 'otpauth';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const BASE_URL = process.env.BASE_URL ?? 'https://front-production.tachiiri.workers.dev';
const ENV_SLUG = BASE_URL.replace(/https?:\/\//, '').replace(/[^a-z0-9]/g, '-');
const AUTH_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), `.auth/${ENV_SLUG}.json`);
const TACHIIRI_ORG_ID = '9c95aa5e-5943-4dd0-9579-ed3725821979';
const GOOGLE_EMAIL = process.env.GOOGLE_EMAIL!;
const GOOGLE_PASSWORD = process.env.GOOGLE_PASSWORD!;
const GITHUB_TOTP_SECRET = process.env.GITHUB_TOTP_SECRET!;

const generateTOTP = () => new OTPAuth.TOTP({
  secret: OTPAuth.Secret.fromBase32(GITHUB_TOTP_SECRET),
  digits: 6,
  period: 30,
}).generate();

let browser: Browser | null = null;
const cleanup = async () => { if (browser) { await browser.close().catch(() => {}); browser = null; } };
process.on('exit', cleanup);
process.on('SIGINT', async () => { await cleanup(); process.exit(1); });

// スクリーンショット → ファイル保存
const ss = async (page: any, name: string) => {
  const p = `/tmp/gc-${name}.png`;
  await page.screenshot({ path: p }).catch(() => {});
  return p;
};

browser = await chromium.launch({ headless: true });
const storageState = JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));
const context = await browser.newContext({ storageState, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

try {
  // 1. DB Apply へ
  await page.goto(`${BASE_URL}/api/auth/select-org?org_id=${TACHIIRI_ORG_ID}`, { waitUntil: 'networkidle' });
  await page.goto(`${BASE_URL}/DB%20Apply`, { waitUntil: 'networkidle' });
  console.log('[1] DB Apply OK');

  // 2. GitHub Connect
  await page.click('a:has-text("GitHub Connect")');
  await page.waitForLoadState('networkidle');
  console.log('[2] GitHub Connect clicked ->', page.url());

  // 3. Continue with Google
  const googleBtn = page.locator('a:has-text("Google"), button:has-text("Google")').first();
  await googleBtn.waitFor({ timeout: 10_000 });
  await googleBtn.click();
  await page.waitForLoadState('networkidle');
  console.log('[3] Google clicked ->', page.url());

  // 4. Google アカウント選択
  if (page.url().includes('accounts.google.com')) {
    const accountBtn = page.locator(`[data-email="${GOOGLE_EMAIL}"], li:has-text("${GOOGLE_EMAIL}")`).first();
    if (await accountBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await accountBtn.click();
    } else {
      await page.fill('input[type="email"]', GOOGLE_EMAIL);
      await page.click('#identifierNext, button:has-text("次へ"), button:has-text("Next")');
    }
    await page.waitForLoadState('networkidle');

    const pwInput = await page.waitForSelector('input[type="password"]', { timeout: 5_000 }).catch(() => null);
    if (pwInput) {
      await page.fill('input[type="password"]', GOOGLE_PASSWORD);
      await page.click('#passwordNext, button:has-text("次へ"), button:has-text("Next")');
      await page.waitForLoadState('networkidle');
    }
    console.log('[4] Google auth done ->', page.url());
  }

  // 5. GitHub 2FA → TOTP で自動入力
  if (page.url().includes('github.com/sessions/two-factor')) {
    console.log('[5] GitHub 2FA 画面 — TOTP で自動入力');

    // TOTP 入力欄を探す（OTP入力 or テキスト入力）
    const otpInput = page.locator('input[name="otp"], input[autocomplete="one-time-code"], input[type="text"]').first();

    // TOTP入力欄が直接ない場合は "More options" → authenticator app を選ぶ
    if (!await otpInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const moreOptions = page.locator('button:has-text("More options"), summary:has-text("More options")').first();
      if (await moreOptions.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await moreOptions.click();
        await page.waitForTimeout(300);
      }
      const totpBtn = page.locator('button:has-text("Authenticator"), button:has-text("totp"), a:has-text("Authenticator")').first();
      if (await totpBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await totpBtn.click();
        await page.waitForLoadState('networkidle');
      }
    }

    const code = generateTOTP();
    console.log(`[5] TOTP コード: ${code}`);
    await page.fill('input[name="otp"], input[autocomplete="one-time-code"], input[type="text"]', code);
    // OTP入力欄は6桁入力で自動送信される場合があるのでclickは任意
    await page.click('button[type="submit"], input[type="submit"]').catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    console.log('[5] TOTP 送信 ->', page.url());
  }

  // 6. アプリに戻るまで待機（最大5分）
  console.log('[6] 承認待ち...');
  await page.waitForURL(
    (url) => !url.toString().includes('github.com') && !url.toString().includes('accounts.google.com'),
    { timeout: 300_000 },
  );
  console.log('[6] 戻ってきました ->', page.url());

  // 7. 確認 & 保存
  const res = await page.goto(`${BASE_URL}/api/auth/status`);
  const json = await res!.json();
  console.log('[status]', JSON.stringify(json));

  if (json.githubConnect?.authenticated) {
    await context.storageState({ path: AUTH_FILE });
    console.log('[完了] セッション保存:', AUTH_FILE);
  } else {
    throw new Error('GitHub Connect 未完了');
  }

} finally {
  await cleanup();
}
