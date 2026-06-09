import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

await page.goto(`${BASE_URL}/sync-storage`, { waitUntil: 'networkidle' });

const envSelect = page.locator('select').nth(3);
const btn = page.locator('button').filter({ hasText: /D1\s+User\s*DB\s*移行/i }).first();

// まず stage のみ再実行してログを全部取得
await envSelect.selectOption({ value: 'stage' });
await page.waitForTimeout(300);
await btn.click();
console.log('Clicked stage — waiting...');
await page.waitForTimeout(60000);

const bodyText = await page.locator('body').textContent();
// ログ部分だけ抽出
const logMatch = bodyText?.match(/=== D1 マイグレーション開始.*$/s);
console.log('Full log:\n', logMatch?.[0] ?? bodyText?.slice(-1500));

await browser.close();
