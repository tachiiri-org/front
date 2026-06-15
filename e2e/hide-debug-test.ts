import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const TARGET = 'https://front-production.tachiiri.workers.dev';
const GRAPH_ID = 'test-debug-id';

const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const contexts = browser.contexts();
const ctx = contexts[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

await page.goto(`${TARGET}/graph-editor`);
await page.waitForTimeout(2000);

// Soft-delete Debug Test via API
const res = await page.evaluate(async (id: string) => {
  const r = await fetch(`/api/graph/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { status: r.status, body: await r.json() };
}, GRAPH_ID);
console.log('Hide result:', JSON.stringify(res));

// Verify final list
const after = await page.evaluate(async () => {
  const r = await fetch('/api/graph/');
  return await r.json();
});
console.log('After:', JSON.stringify(after));
