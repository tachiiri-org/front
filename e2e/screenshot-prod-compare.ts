import { chromium } from '@playwright/test';
import * as fs from 'fs';

const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();
const cdp = await page.context().newCDPSession(page);

// Column view
await cdp.send('Page.navigate', { url: 'https://front-production.tachiiri.workers.dev/graph-editor' });
await new Promise(r => setTimeout(r, 4000));
const { data: d1 } = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('/tmp/prod-cols.png', Buffer.from(d1, 'base64'));
console.log('cols saved');

// Switch to outliner
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 3000));
const { data: d2 } = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('/tmp/prod-outline.png', Buffer.from(d2, 'base64'));
console.log('outline saved');

await b.close();
