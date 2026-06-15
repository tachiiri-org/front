import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const TARGET = 'https://front-production.tachiiri.workers.dev';
const GRAPH_ID = 'a409e5b1-8892-4729-adac-470b5cdd5646';

const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const contexts = browser.contexts();
const ctx = contexts[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

await page.goto(`${TARGET}/graph-editor`);
await page.waitForTimeout(1500);

const res = await page.evaluate(async (id: string) => {
  const r = await fetch(`/api/graph/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { status: r.status, body: await r.json() };
}, GRAPH_ID);
console.log('DELETE result:', JSON.stringify(res));

const final = await page.evaluate(async () => {
  const r = await fetch('/api/graph/');
  const d = await r.json() as { graphs: Array<{ id: string; name: string }> };
  return d.graphs;
});
console.log('Final graphs:', JSON.stringify(final, null, 2));
