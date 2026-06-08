/**
 * 現在の 2FA ページで TOTP を入力する
 */
import { chromium } from '@playwright/test';
import { generateTOTP, BASE_URL, TACHIIRI_ORG_ID, AUTH_FILE } from './session.ts';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

console.log('current url:', page.url());

// Authenticator app ページへ
const appLink = page.locator('a:has-text("Authenticator app"), a[href*="/two-factor/app"]').first();
if (await appLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
  await appLink.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('navigated to:', page.url());
} else {
  // More options 展開
  const moreOptions = page.locator('button:has-text("More options")').first();
  if (await moreOptions.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await moreOptions.click();
    await page.waitForTimeout(500);
    const appLink2 = page.locator('a:has-text("Authenticator app")').first();
    if (await appLink2.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await appLink2.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      console.log('navigated to:', page.url());
    }
  }
}

const code = generateTOTP();
console.log('TOTP code:', code);
await page.fill('input[name="otp"], input[autocomplete="one-time-code"], input[type="text"]', code);
await page.click('button[type="submit"], input[type="submit"]').catch(() => {});
await page.waitForLoadState('networkidle').catch(() => {});
console.log('after TOTP url:', page.url());

// アプリの OAuth フロー完了まで待機
if (!page.url().startsWith(BASE_URL)) {
  // GitHub Connect の return_to でアプリに戻るまで待つ
  await page.waitForURL((url) => url.toString().startsWith(BASE_URL) || url.toString().includes('github.com/login/oauth'), { timeout: 15_000 }).catch(() => {});
  console.log('final url:', page.url());
}

// アプリに戻ったか確認
if (page.url().startsWith(BASE_URL) || page.url().includes('github.com')) {
  // GitHub OAuth の Authorize ページが出た場合
  const authorizeBtn = page.locator('button:has-text("Authorize"), input[value="Authorize"]').first();
  if (await authorizeBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await authorizeBtn.click();
    await page.waitForLoadState('networkidle');
  }
}

// 続けてアプリへ
if (!page.url().startsWith(BASE_URL)) {
  await page.goto(`${BASE_URL}/api/auth/select-org?org_id=${TACHIIRI_ORG_ID}`, { waitUntil: 'networkidle' });
}
await context.storageState({ path: AUTH_FILE });
console.log('session saved to', AUTH_FILE);

const res = await page.goto(`${BASE_URL}/api/auth/status`);
const status = await res!.json();
console.log('auth status:', JSON.stringify(status));
process.exit(0);
