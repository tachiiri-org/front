import { chromium } from '@playwright/test';
import * as fs from 'fs';

const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();
const cdp = await page.context().newCDPSession(page);

await cdp.send('Page.navigate', { url: 'https://front-dev.tachiiri.workers.dev/graph-editor' });
await new Promise(r => setTimeout(r, 5000));

// Switch to EN mode
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  const enBtn = btns.find(b => b.textContent?.trim() === 'EN');
  if (enBtn) enBtn.click();
});
await new Promise(r => setTimeout(r, 1000));

// Click the sentinel node
await page.evaluate(() => {
  const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-node-id="3cf7044b-5378-4aff-97f2-e4411755ba99"]');
  if (ta) ta.focus();
});
await new Promise(r => setTimeout(r, 3000));

const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('/tmp/orphaned-dev-en.png', Buffer.from(data, 'base64'));

const col1Count = await page.evaluate(() => document.querySelectorAll('[data-col-index="1"] textarea[data-node-id]').length);
console.log('col1 nodes (EN mode):', col1Count);
console.log('saved /tmp/orphaned-dev-en.png');
await b.close();
