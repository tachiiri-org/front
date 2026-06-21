import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0];
const page = ctx.pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 4000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2500));
// Try locating with playwright locator instead of evaluate
const sq = page.locator('span').filter({ hasText: '' }).first();
const count = await page.locator('[data-node-id]').count();
console.log('node rows:', count);
// Right-click on first row (anywhere on node text)
const firstText = page.locator('textarea').first();
const fBox = await firstText.boundingBox();
console.log('textarea box:', fBox);
if (fBox) {
  // Click slightly to the left of the textarea to hit the square
  await page.mouse.click(fBox.x - 15, fBox.y + fBox.height / 2);
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: '/tmp/prop-menu-open.png' });
}
await b.close();
