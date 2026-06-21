import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 5000));
await page.click('button:has-text("パネル")');
await new Promise(r => setTimeout(r, 3000));
// Open filter menu on pane 1
await page.mouse.click(155, 55); // Click "フィルタ" area in pane 1 header
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: '/tmp/pane-flt-v2.png' });
await b.close();
