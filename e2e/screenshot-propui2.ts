import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 3000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2000));
// Click the first expand marker square (left square in each row)
await page.evaluate(() => {
  const markers = [...document.querySelectorAll('[data-expand-marker]')] as HTMLElement[];
  markers[0]?.parentElement?.click();
});
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: '/tmp/prop-ui.png' });
await b.close();
