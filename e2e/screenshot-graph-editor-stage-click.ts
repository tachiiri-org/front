import { chromium } from '@playwright/test';
import * as fs from 'fs';

const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();
const cdp = await page.context().newCDPSession(page);

await cdp.send('Page.navigate', { url: 'https://front-stage.tachiiri.workers.dev/graph-editor' });
await new Promise(r => setTimeout(r, 5000));

// Focus first bookmark node to trigger children column
await page.evaluate(() => {
  const textareas = document.querySelectorAll<HTMLTextAreaElement>('[data-col-index="0"] textarea[data-node-id]');
  if (textareas.length > 0) textareas[0].focus();
});
await new Promise(r => setTimeout(r, 3000));

const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('/tmp/graph-editor-stage-clicked.png', Buffer.from(data, 'base64'));

const col1Count = await page.evaluate(() => document.querySelectorAll('[data-col-index="1"] textarea[data-node-id]').length);
console.log('col1 nodes:', col1Count);
console.log('saved /tmp/graph-editor-stage-clicked.png');
await b.close();
