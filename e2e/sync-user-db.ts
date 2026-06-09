import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

await page.goto(`${BASE_URL}/sync-storage`, { waitUntil: 'networkidle' });

const envSelect = page.locator('select').nth(3); // Stage / Dev selector
const btn = page.locator('button').filter({ hasText: /D1\s+User\s*DB\s*移行/i }).first();

for (const value of ['stage', 'dev']) {
  console.log(`\n=== ${value} への D1 User DB 移行 ===`);
  await envSelect.selectOption({ value });
  await page.waitForTimeout(300);

  await page.screenshot({ path: `/tmp/sync-user-db-${value}-before.png` });
  await btn.click();
  console.log('Clicked — waiting for result...');

  await page.waitForTimeout(60000);
  await page.screenshot({ path: `/tmp/sync-user-db-${value}-result.png` });

  const bodyText = await page.locator('body').textContent();
  console.log('Result:', bodyText?.slice(0, 600));
}

await browser.close();
console.log('\nDone');
