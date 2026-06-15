import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const TARGET = 'https://front-production.tachiiri.workers.dev';

const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const contexts = browser.contexts();
const ctx = contexts[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

await page.goto(`${TARGET}/graph-editor`);
await page.waitForTimeout(2000);

const graphs = await page.evaluate(async () => {
  const r = await fetch('/api/graph/');
  const d = await r.json() as { graphs: Array<{ id: string; name: string }> };
  return d.graphs;
});
console.log('All graphs:', JSON.stringify(graphs, null, 2));

const splatoon = graphs.filter((g: { id: string; name: string }) => g.name === 'スプラトゥーン');
console.log('Splatoon graphs:', splatoon.length);

// Delete all but the last one (keep the most recently created)
const toDelete = splatoon.slice(0, -1);
for (const g of toDelete) {
  const res = await page.evaluate(async (id: string) => {
    const r = await fetch(`/api/graph/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { status: r.status, body: await r.json() };
  }, g.id);
  console.log(`DELETE ${g.id} (${g.name}):`, JSON.stringify(res));
}

// Rename the remaining one
const keep = splatoon[splatoon.length - 1];
if (keep) {
  const renameRes = await page.evaluate(async (args: { id: string; name: string }) => {
    const r = await fetch(`/api/graph/${encodeURIComponent(args.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: args.name }),
    });
    return { status: r.status, body: await r.json() };
  }, { id: keep.id, name: 'スプラトゥーン3' });
  console.log(`RENAME ${keep.id} → スプラトゥーン3:`, JSON.stringify(renameRes));
}

const final = await page.evaluate(async () => {
  const r = await fetch('/api/graph/');
  const d = await r.json() as { graphs: Array<{ id: string; name: string }> };
  return d.graphs;
});
console.log('Final graphs:', JSON.stringify(final, null, 2));
