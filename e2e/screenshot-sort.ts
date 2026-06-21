import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph/word-graph-1', { waitUntil: 'networkidle' });
await new Promise(r => setTimeout(r, 1500));
// Click graph-editor page in nav
const link = page.locator('text=graph-editor').first();
if (await link.isVisible()) {
  await link.click();
  await new Promise(r => setTimeout(r, 2000));
}
await page.screenshot({ path: '/tmp/ge-sort.png' });
console.log('done', page.url());
await b.close();
