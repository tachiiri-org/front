import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL ?? 'https://front-production.tachiiri.workers.dev';
const ENV_SLUG = BASE_URL.replace(/https?:\/\//, '').replace(/[^a-z0-9]/g, '-');
const AUTH_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), `.auth/${ENV_SLUG}.json`);
const TACHIIRI_ORG_ID = '9c95aa5e-5943-4dd0-9579-ed3725821979';

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ storageState: AUTH_FILE, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

// DB Apply → GitHub Connect → GitHub login
await page.goto(`${BASE_URL}/api/auth/select-org?org_id=${TACHIIRI_ORG_ID}`, { waitUntil: 'networkidle' });
await page.goto(`${BASE_URL}/DB%20Apply`, { waitUntil: 'networkidle' });
await page.click('a:has-text("GitHub Connect")');
await page.waitForLoadState('networkidle');

// Continue with Google
const googleBtn = page.locator('a:has-text("Google"), button:has-text("Google")').first();
if (await googleBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
  await googleBtn.click();
  await page.waitForLoadState('networkidle');
}

// Google account chooser
if (page.url().includes('accounts.google.com')) {
  const accountBtn = page.locator('[data-email="admin@tachiiri.com"], li:has-text("admin@tachiiri.com")').first();
  if (await accountBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await accountBtn.click();
    await page.waitForLoadState('networkidle');
  }
}

// WebAuthn or 2FA page に到達したらスクリーンショット
await page.screenshot({ path: '/tmp/github-2fa.png', fullPage: true });
console.log('url:', page.url());

// ページ内のリンクやボタンを列挙
const links = await page.evaluate(() =>
  Array.from(document.querySelectorAll('a, button')).map(el => ({
    tag: el.tagName,
    text: el.textContent?.trim().slice(0, 80),
    href: (el as HTMLAnchorElement).href ?? '',
  })).filter(el => el.text)
);
console.log('page elements:', JSON.stringify(links, null, 2));

await browser.close();
