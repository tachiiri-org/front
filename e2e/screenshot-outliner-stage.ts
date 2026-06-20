import { chromium } from '@playwright/test';
import * as fs from 'fs';

const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();
const cdp = await page.context().newCDPSession(page);

await cdp.send('Page.navigate', { url: 'https://front-stage.tachiiri.workers.dev/graph-editor' });
await new Promise(r => setTimeout(r, 3000));

await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2000));

const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('/tmp/outliner-stage.png', Buffer.from(data, 'base64'));
console.log('saved');
await b.close();
