/**
 * db-migrate スクリーンで User DB expand を実行するスクリプト
 * Usage: npx tsx e2e/apply-user-db-expand.ts [env]
 * env: production (default) | stage | dev
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const env = (process.argv[2] ?? 'production') as 'production' | 'stage' | 'dev';
const envUrls: Record<string, string> = {
  production: 'https://front-production.tachiiri.workers.dev',
  stage: 'https://front-stage.tachiiri.workers.dev',
  dev: 'https://front-dev.tachiiri.workers.dev',
};
const baseUrl = envUrls[env] ?? BASE_URL;

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

console.log(`Navigating to ${baseUrl}/db-migrate ...`);
await page.goto(`${baseUrl}/db-migrate`, { waitUntil: 'networkidle' });
await page.screenshot({ path: '/tmp/user-db-expand-0-initial.png' });
console.log('Initial screenshot saved');

// GitHub Connect が必要な場合は認証する
const needsAuth = await page.locator('text=GitHub Connect login required').isVisible({ timeout: 3000 }).catch(() => false);
if (needsAuth) {
  console.log('GitHub Connect login required — clicking GitHub Connect...');
  await page.locator('a, button').filter({ hasText: /GitHub Connect/i }).first().click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/user-db-expand-1-after-auth.png' });
  console.log('After auth screenshot saved');
}

// "User DB" タブをクリック
console.log('Clicking User DB tab...');
await page.locator('button, [role="tab"]').filter({ hasText: /User DB/i }).first().click();
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/user-db-expand-2-user-db-tab.png' });
console.log('User DB tab screenshot saved');

// Apply Expand ボタンをクリック
const expandBtn = page.locator('button').filter({ hasText: /Apply\s*Expand/i }).first();
if (!await expandBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
  const buttons = await page.locator('button').allTextContents();
  console.log('Available buttons:', buttons);
  await browser.close();
  process.exit(1);
}

console.log('Clicking Apply Expand...');
await expandBtn.click();

// 結果を待つ（最大30秒）
await page.waitForTimeout(30000);
await page.screenshot({ path: '/tmp/user-db-expand-3-result.png' });
console.log('Result screenshot saved');

const bodyText = await page.locator('body').textContent();
console.log('Page text snippet:', bodyText?.slice(0, 1000));

await browser.close();
