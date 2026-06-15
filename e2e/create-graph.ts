import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const TARGET = 'https://front-production.tachiiri.workers.dev';

async function main() {
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const contexts = browser.contexts();
  const ctx = contexts[0] ?? await browser.newContext();
  const page = await ctx.newPage();

  await page.goto(`${TARGET}/graph-editor`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Override window.prompt to return our value without showing native dialog
  await page.evaluate(() => {
    window.prompt = (_msg?: string, _def?: string) => 'スプラトゥーン';
  });

  // Wait for POST response
  const postPromise = page.waitForResponse(
    (resp) => resp.url().includes('/api/graph') && resp.request().method() === 'POST',
    { timeout: 10000 },
  );

  // Click the + button inside the word-graph column
  const plusBtn = page.locator('[data-frame-id] button').filter({ hasText: '+' }).first();
  await plusBtn.dispatchEvent('mousedown');

  const resp = await postPromise;
  const body = await resp.json() as Record<string, unknown>;
  console.log('POST result:', resp.status(), JSON.stringify(body));

  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/graph-splatoon.png' });

  const selectVal = await page.locator('[data-frame-id] select').first().inputValue();
  const options = await page.locator('[data-frame-id] select').first().locator('option').allTextContents();
  console.log('select value:', selectVal);
  console.log('options:', options);

  await page.close();
}

main().catch(console.error);
