import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
const cdp = await page.context().newCDPSession(page);
await cdp.send('Page.navigate', { url: 'https://front-dev.tachiiri.workers.dev/graph-editor' });
await new Promise(r => setTimeout(r, 3000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2000));
// Click filter button
const filterBtnRect = await page.evaluate(() => {
  const all = [...document.querySelectorAll('button')];
  const f = all.find(b => b.textContent?.trim() === 'フィルタ');
  if (!f) return null;
  f.click();
  const r = f.getBoundingClientRect();
  return { x: r.left, y: r.bottom };
});
console.log('filterBtn:', filterBtnRect);
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/filter-menu.png' });
await b.close();
