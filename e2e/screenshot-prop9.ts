import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 4000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2500));
// Click the first 6x6 node square to open property menu - use getBoundingClientRect properly
const rect = await page.evaluate(() => {
  const sq = [...document.querySelectorAll<HTMLElement>('span')].find(s => {
    const style = s.getAttribute('style') || '';
    return style.includes('width: 6px') && style.includes('height: 6px');
  });
  if (!sq) { console.log('not found'); return null; }
  const r = sq.getBoundingClientRect();
  console.log('rect:', r.left, r.top, r.right, r.bottom);
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});
console.log('rect:', rect);
if (rect && rect.top > 0) {
  await page.mouse.click(rect.left + rect.width/2, rect.top + rect.height/2);
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: '/tmp/prop-menu-open.png' });
}
await b.close();
