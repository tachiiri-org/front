import { chromium } from '@playwright/test';
import * as fs from 'fs';

const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();
const cdp = await page.context().newCDPSession(page);

await cdp.send('Page.navigate', { url: 'https://front-dev.tachiiri.workers.dev/graph-editor' });
await new Promise(r => setTimeout(r, 3000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 1500));
// Click first marker span (expand button wrapper area)
await page.evaluate(() => {
  const markers = document.querySelectorAll<HTMLElement>('[data-expand-marker]');
  (markers[0]?.parentElement as HTMLElement)?.click();
});
await new Promise(r => setTimeout(r, 1200));
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('/tmp/outliner-expanded.png', Buffer.from(data, 'base64'));
console.log('saved');
await b.close();
