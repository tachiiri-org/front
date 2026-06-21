import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 3000));
await page.click('button:has-text("パネル")');
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: '/tmp/panes-view.png' });
await b.close();
