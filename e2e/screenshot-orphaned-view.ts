import { chromium } from '@playwright/test';
import * as fs from 'fs';

const ENV = process.argv[2] ?? 'dev';
const URL_MAP: Record<string, string> = {
  dev: 'https://front-dev.tachiiri.workers.dev/graph-editor',
  stage: 'https://front-stage.tachiiri.workers.dev/graph-editor',
  production: 'https://front-production.tachiiri.workers.dev/graph-editor',
};
const OUT_MAP: Record<string, string> = {
  dev: '/tmp/orphaned-dev.png',
  stage: '/tmp/orphaned-stage.png',
  production: '/tmp/orphaned-prod.png',
};
const SENTINEL_MAP: Record<string, string> = {
  dev: '3cf7044b-5378-4aff-97f2-e4411755ba99',
  stage: '',
  production: '',
};

const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();
const cdp = await page.context().newCDPSession(page);

await cdp.send('Page.navigate', { url: URL_MAP[ENV] });
await new Promise(r => setTimeout(r, 5000));

// Click the sentinel node (孤立ノード)
const sentinelId = SENTINEL_MAP[ENV];
if (sentinelId) {
  await page.evaluate((id) => {
    const ta = document.querySelector<HTMLTextAreaElement>(`textarea[data-node-id="${id}"]`);
    if (ta) ta.focus();
  }, sentinelId);
} else {
  // Fallback: click last bookmark
  await page.evaluate(() => {
    const all = document.querySelectorAll<HTMLTextAreaElement>('[data-col-index="0"] textarea[data-node-id]');
    const last = all[all.length - 1];
    if (last) last.focus();
  });
}
await new Promise(r => setTimeout(r, 3000));

const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(OUT_MAP[ENV], Buffer.from(data, 'base64'));

const col1Count = await page.evaluate(() => document.querySelectorAll('[data-col-index="1"] textarea[data-node-id]').length);
console.log('env:', ENV, '| col1 nodes:', col1Count);
console.log('saved:', OUT_MAP[ENV]);
await b.close();
