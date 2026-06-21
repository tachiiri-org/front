import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 5000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 3000));
// Open property menu on first node
await page.mouse.click(43, 105);
await new Promise(r => setTimeout(r, 800));
// Click the pill "debug_tag" to activate it
await page.mouse.click(110, 178);
await new Promise(r => setTimeout(r, 500));
// Reopen menu to see filled square
await page.mouse.click(43, 105);
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: '/tmp/prop-active.png' });
await b.close();
