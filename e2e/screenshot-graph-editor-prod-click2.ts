import { chromium } from '@playwright/test';
import * as fs from 'fs';

const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();
const cdp = await page.context().newCDPSession(page);

await cdp.send('Page.navigate', { url: 'https://front-production.tachiiri.workers.dev/graph-editor' });
await new Promise(r => setTimeout(r, 5000));

// Focus the specific node we know has children
await page.evaluate(() => {
  const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-node-id="4b954fc3-e9b8-4ee6-a819-06387c5f4401"]');
  if (ta) ta.focus();
});
await new Promise(r => setTimeout(r, 3000));

const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('/tmp/graph-editor-prod-clicked2.png', Buffer.from(data, 'base64'));

const col1Count = await page.evaluate(() => document.querySelectorAll('[data-col-index="1"] textarea[data-node-id]').length);
const col0Count = await page.evaluate(() => document.querySelectorAll('[data-col-index="0"] textarea[data-node-id]').length);
console.log('col0 nodes:', col0Count, '| col1 nodes:', col1Count);
console.log('saved /tmp/graph-editor-prod-clicked2.png');
await b.close();
