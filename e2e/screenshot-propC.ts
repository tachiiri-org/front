import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 5000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 3000));
// Get viewport info
const vp = page.viewportSize();
console.log('viewport:', vp);
// Click at approx position of first row square (based on earlier screenshots)
// First row "testtest" appears at y~105, square at x~43
await page.mouse.click(43, 105);
await new Promise(r => setTimeout(r, 1000));
await page.screenshot({ path: '/tmp/prop-menu-open.png' });
await b.close();
