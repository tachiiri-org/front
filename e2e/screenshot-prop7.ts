import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 4000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2500));
// Debug: find all spans with inline style
const spans = await page.evaluate(() => {
  const all = [...document.querySelectorAll<HTMLElement>('span[style]')];
  return all.slice(0, 20).map(s => s.getAttribute('style')?.slice(0, 80));
});
console.log('spans:', JSON.stringify(spans, null, 2));
await b.close();
