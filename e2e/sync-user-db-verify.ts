import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

// migration API のレスポンスをキャプチャ
const apiResponses: string[] = [];
page.on('response', async (res) => {
  const url = res.url();
  if (url.includes('/migration/user-databases')) {
    try {
      const text = await res.text();
      apiResponses.push(`${res.status()} ${url}\n${text.slice(0, 2000)}`);
    } catch {
      apiResponses.push(`${res.status()} ${url} (could not read body)`);
    }
  }
});

await page.goto(`${BASE_URL}/sync-storage`, { waitUntil: 'networkidle' });

const envSelect = page.locator('select').nth(3);
const btn = page.locator('button').filter({ hasText: /D1\s+User\s*DB\s*移行/i }).first();

for (const value of ['stage', 'dev']) {
  console.log(`\n=== ${value} ===`);
  await envSelect.selectOption({ value });
  await page.waitForTimeout(300);
  await btn.click();
  // 最大120秒待機
  await page.waitForTimeout(120000);
  const bodyText = await page.locator('body').textContent();
  const logMatch = bodyText?.match(/=== D1 マイグレーション開始.*$/s);
  console.log(logMatch?.[0]?.slice(-1000) ?? '(no log)');
}

console.log('\n=== API Responses ===');
for (const r of apiResponses) console.log(r, '\n---');

await browser.close();
