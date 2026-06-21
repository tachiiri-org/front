import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 4000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2500));
// Click square of first row (btnWrap square) to open property menu
await page.evaluate(() => {
  const allSpans = [...document.querySelectorAll<HTMLSpanElement>('span')];
  // Find the colored square in row (8x8)
  const sq = allSpans.find(s => s.style.width === '8px' && s.style.height === '8px' && !s.dataset.type);
  console.log('found sq:', sq?.outerHTML?.slice(0, 100));
  sq?.click();
});
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: '/tmp/prop-menu.png' });
await b.close();
