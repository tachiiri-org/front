import { chromium } from '@playwright/test';
import * as fs from 'fs';

const ENV = process.argv[2] ?? 'dev';
const URL_MAP: Record<string, string> = {
  dev: 'https://front-dev.tachiiri.workers.dev/graph-editor',
  stage: 'https://front-stage.tachiiri.workers.dev/graph-editor',
  production: 'https://front-production.tachiiri.workers.dev/graph-editor',
};
// 修正項目ノードID (per env)
const FIX_NODE_MAP: Record<string, string> = {
  dev: 'a580a15f-01e7-4f4f-82d9-3e3ab7b6816f',
  stage: 'a580a15f-01e7-4f4f-82d9-3e3ab7b6816f',
  production: 'a580a15f-01e7-4f4f-82d9-3e3ab7b6816f',
};

const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();
const cdp = await page.context().newCDPSession(page);

await cdp.send('Page.navigate', { url: URL_MAP[ENV] });
await new Promise(r => setTimeout(r, 5000));

await page.evaluate((id) => {
  const ta = document.querySelector<HTMLTextAreaElement>(`textarea[data-node-id="${id}"]`);
  if (ta) ta.focus();
}, FIX_NODE_MAP[ENV]);
await new Promise(r => setTimeout(r, 3000));

const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`/tmp/fix-tag-${ENV}.png`, Buffer.from(data, 'base64'));

const col1Count = await page.evaluate(() => document.querySelectorAll('[data-col-index="1"] textarea[data-node-id]').length);
console.log(`env: ${ENV} | col1 nodes: ${col1Count}`);
console.log(`saved: /tmp/fix-tag-${ENV}.png`);
await b.close();
