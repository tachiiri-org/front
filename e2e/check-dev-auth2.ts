import { chromium } from '@playwright/test';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor', { waitUntil: 'networkidle' });

// How many texts does the dev API actually return?
const textsRes = await page.evaluate(async () => {
  const r = await fetch('/api/graph/word-graph-1/texts');
  const data = await r.json() as { texts?: {id: string}[] };
  return { status: r.status, count: data.texts?.length, sample: data.texts?.slice(0,3).map(t => t.id) };
});
console.log('GET /texts:', textsRes);

// Does b46909b6 appear?
const found = await page.evaluate(async () => {
  const r = await fetch('/api/graph/word-graph-1/texts');
  const data = await r.json() as { texts?: {id: string}[] };
  return data.texts?.find(t => t.id === 'b46909b6-5dc7-483c-9f4b-75f90efa9520');
});
console.log('b46909b6 in dev texts:', found);

await browser.close();
