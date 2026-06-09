import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const STAGE_URL = 'https://front-stage.tachiiri.workers.dev';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

await page.goto(`${STAGE_URL}/graph-editor`, { waitUntil: 'networkidle' });

// ログインが必要な場合は GitHub でログイン
const loginNeeded = await page.locator('text=Login...').isVisible({ timeout: 3000 }).catch(() => false);
if (loginNeeded) {
  console.log('Logging in to stage...');
  await page.locator('select').filter({ hasText: 'Login' }).selectOption({ value: '/oauth/github/start' });
  await page.waitForURL('**/github.com/**', { timeout: 10000 }).catch(() => {});
  // GitHub は既にログイン済みのはず
  await page.waitForURL(`${STAGE_URL}/**`, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.goto(`${STAGE_URL}/graph-editor`, { waitUntil: 'networkidle' });
}

await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/graph-editor-stage-authed.png', fullPage: false });
console.log('saved: /tmp/graph-editor-stage-authed.png');

await browser.close();
