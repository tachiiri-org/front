import { chromium } from '@playwright/test';

const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();
const cdp = await page.context().newCDPSession(page);

await cdp.send('Page.navigate', { url: 'https://front-dev.tachiiri.workers.dev/graph-editor' });
await new Promise(r => setTimeout(r, 3000));

await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2000));

const result = await page.evaluate(async () => {
  const rows = document.querySelectorAll('[data-node-id]');
  const nodeId = rows[0]?.getAttribute('data-node-id') ?? 'none';

  const r = await fetch('/api/v1/graph/word-graph-1/node/' + nodeId + '/property', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'test_debug', value: 'hello' }),
  });
  const body = await r.text();
  return { status: r.status, body, nodeId };
});

console.log('POST property result:', JSON.stringify(result, null, 2));

// Now fetch the node to check if property is returned
const checkResult = await page.evaluate(async (nodeId: string) => {
  const r = await fetch('/api/v1/graph/word-graph-1/node/' + nodeId + '/children?limit=20');
  return { status: r.status, body: await r.text() };
}, result.nodeId);

console.log('Children response (check properties):', checkResult.body.slice(0, 500));

await b.close();
