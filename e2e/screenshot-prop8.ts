import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 4000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2500));
// Click the first node square (6x6px) to open property menu
const info = await page.evaluate(() => {
  const sq = document.querySelector<HTMLElement>('span[style*="width: 6px"][style*="height: 6px"]');
  if (!sq) return null;
  const r = sq.getBoundingClientRect();
  return { x: r.left + r.width/2, y: r.top + r.height/2 };
});
console.log('sq6:', info);
if (info) {
  await page.mouse.click(info.x, info.y);
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: '/tmp/prop-menu-open.png' });
}
await b.close();
