import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
// Clear localStorage for a clean test
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await page.evaluate(() => {
  // Remove old pane config so we start fresh
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('graph-editor-panes')) localStorage.removeItem(k);
  }
});
await new Promise(r => setTimeout(r, 1000));
await page.reload();
await new Promise(r => setTimeout(r, 5000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 3000));
// Open property menu on first node, assign debug_tag
await page.mouse.click(43, 105);
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: '/tmp/clean-prop-menu.png' });
await b.close();
