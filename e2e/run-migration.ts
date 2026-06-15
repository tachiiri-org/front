import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const TARGET = process.argv[2] ?? 'https://front-dev.tachiiri.workers.dev';

const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const contexts = browser.contexts();
const ctx = contexts[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

await page.goto(`${TARGET}/db-migrate`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Try GitHub Connect if needed
const ghConnectLink = page.locator('a').filter({ hasText: 'GitHub Connect' }).first();
if (await ghConnectLink.isVisible({ timeout: 3000 }).catch(() => false)) {
  console.log('GitHub Connect needed, clicking...');
  await ghConnectLink.click({ force: true });
  await page.waitForLoadState('networkidle');
  if (page.url().includes('github.com')) {
    const authorizeBtn = page.locator('button:has-text("Authorize"), input[value="Authorize"]').first();
    if (await authorizeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await authorizeBtn.click();
      await page.waitForLoadState('networkidle');
    }
  }
  await page.waitForURL(url => url.toString().startsWith(TARGET), { timeout: 30000 });
  console.log('GitHub Connect done, back at:', page.url());
  await page.goto(`${TARGET}/db-migrate`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
}

// Click "User DB" section if needed
const userDbBtn = page.locator('button').filter({ hasText: 'User DB' }).first();
if (await userDbBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await userDbBtn.click();
  await page.waitForTimeout(1000);
}

// Click "Apply Expand"
const applyExpandBtn = page.locator('button').filter({ hasText: 'Apply Expand' }).first();
console.log('Apply Expand count:', await applyExpandBtn.count());
await applyExpandBtn.click();
console.log('Clicked Apply Expand, waiting 15s...');
await page.waitForTimeout(15000);

const afterText = await page.locator('body').innerText();
console.log('Result:', afterText.split('\n').filter(l => l.includes('===') || l.includes('0006') || l.includes('success') || l.includes('fail') || l.includes('error') || l.includes('Error') || l.includes('skip')).join('\n'));

await page.screenshot({ path: '/tmp/db-migrate-result.png' });
console.log('screenshot: /tmp/db-migrate-result.png');
