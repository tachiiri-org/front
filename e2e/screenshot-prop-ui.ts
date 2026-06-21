import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 3000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2000));
// Open property menu on first node
await page.evaluate(() => {
  const squares = document.querySelectorAll<HTMLElement>('[data-sq]');
  console.log('sq count:', squares.length);
});
// Right-click first node to get property menu
const rows = await page.$$('[data-node-id]');
if (rows.length > 0) {
  await rows[0].click({ button: 'right' });
  await new Promise(r => setTimeout(r, 300));
}
await page.screenshot({ path: '/tmp/prop-ctx.png' });
// Close any menu
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 200));
// Click left square on first row to open property menu
await page.evaluate(() => {
  const allBtns = document.querySelectorAll('span[style*="width:8px"]');
  console.log('sq btns:', allBtns.length);
  (allBtns[0] as HTMLElement)?.click();
});
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/prop-menu-sq.png' });
await b.close();
