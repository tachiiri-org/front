import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 3000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2000));
// Click the first square marker to open property menu
const clicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('[data-node-id] span[style*="cursor:pointer"]')] as HTMLElement[];
  if (btns[0]) { btns[0].click(); return true; }
  return false;
});
console.log('square clicked:', clicked);
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: '/tmp/prop-ui.png' });
await b.close();
