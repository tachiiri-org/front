import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-stage.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 5000));
await page.screenshot({ path: '/tmp/stage-check.png' });
await b.close();
