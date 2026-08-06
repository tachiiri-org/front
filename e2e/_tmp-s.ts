import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  storageState: JSON.parse(readFileSync('./e2e/.auth/kakeibo-tachiiri-com.json', 'utf-8')),
  viewport: { width: 1400, height: 900 }, colorScheme: 'dark',
});
const page = await ctx.newPage();
await page.goto('https://kakeibo.tachiiri.com/import', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.kk-card', { timeout: 30000 });
await page.waitForTimeout(2500);
const card = page.locator('.kk-card').filter({ hasText: 'カード別' }).first();
await card.scrollIntoViewIfNeeded();
const b = (await card.boundingBox())!;
const sy = await page.evaluate(() => window.scrollY);
const sx = await page.evaluate(() => window.scrollX);
await page.screenshot({ path: process.argv[2], fullPage: true,
  clip: { x: b.x + sx, y: b.y + sy, width: Math.min(b.width, 1150), height: Math.min(b.height, 560) } });
console.log('ok');
await browser.close();
