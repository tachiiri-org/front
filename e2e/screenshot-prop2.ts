import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 3000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2000));
// Right-click first textarea to open node property menu
const tas = await page.$$('textarea');
if (tas[0]) {
  await tas[0].click({ button: 'right' });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: '/tmp/node-ctx.png' });
  // Press Escape
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 200));
}
// Click first square btn (inside property menu – need to open via left square on node row)
// Left-click first node square (the colored square on the left of each row)
await page.evaluate(() => {
  // the left square in the node row (btnWrap > square span)
  const nodeSquare = document.querySelector<HTMLElement>('[data-node-id] span[style*="border-radius:2px"]');
  console.log('nodeSquare:', nodeSquare?.outerHTML?.slice(0,80));
  nodeSquare?.click();
});
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/prop-menu-via-sq.png' });
await b.close();
