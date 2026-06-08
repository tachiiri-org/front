/**
 * DB Apply スクリーンで identity expand を実行するスクリプト
 * Usage: npx tsx e2e/apply-identity-expand.ts
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

await page.goto(`${BASE_URL}/DB%20Apply`, { waitUntil: 'networkidle' });
await page.screenshot({ path: '/tmp/db-apply-before.png' });
console.log('Before screenshot saved');

// identity expand ボタンを探す
const expandBtn = page.locator('button').filter({ hasText: /identity.*expand|expand.*identity/i }).first();
const fallbackBtn = page.locator('button').filter({ hasText: /Apply Expand/i }).first();

let btn = await expandBtn.isVisible({ timeout: 3000 }).catch(() => false) ? expandBtn : fallbackBtn;

if (!await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
  // テキストで探せない場合は全ボタンをリスト
  const buttons = await page.locator('button').allTextContents();
  console.log('Available buttons:', buttons);
  await browser.close();
  process.exit(1);
}

console.log('Clicking expand button...');
await btn.click();
await page.waitForTimeout(5000);
await page.screenshot({ path: '/tmp/db-apply-after.png' });
console.log('After screenshot saved');

// 結果確認
const bodyText = await page.locator('body').textContent();
console.log('Page text snippet:', bodyText?.slice(0, 500));

await browser.close();
