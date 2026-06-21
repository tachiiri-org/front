import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 4000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2500));
// Click the colored square on first row (the btnWrap square that opens property menu)
// It's a span with border-radius:2px and cursor:pointer inside a div[data-node-id]
const info = await page.evaluate(() => {
  const nodeRows = document.querySelectorAll<HTMLElement>('[style*="display:flex"][style*="align-items:center"]');
  let found: HTMLElement | null = null;
  for (const row of nodeRows) {
    const sq = row.querySelector<HTMLElement>('span[style*="border-radius:2px"][style*="cursor:pointer"]');
    if (sq) { found = sq; break; }
  }
  if (found) {
    const r = found.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2, html: found.outerHTML.slice(0,100) };
  }
  return null;
});
console.log('btnWrap sq:', info);
if (info) {
  await page.mouse.click(info.x, info.y);
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: '/tmp/prop-menu-open.png' });
}
await b.close();
