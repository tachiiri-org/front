import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

await page.goto(`${BASE_URL}/graph-editor`);
await page.waitForLoadState('networkidle');

const newLayout = {
  grid: { kind: 'grid', columns: 120, rows: 120 },
  frames: [
    {
      kind: 'word-graph-word-col',
      id: 'wg-word-col-1',
      graphId: 'word-graph-1',
      placement: { x: 1, y: 1, width: 24, height: 120 },
      name: 'col-1',
    },
    {
      kind: 'word-graph-text-col',
      id: 'wg-text-col-2',
      graphId: 'word-graph-1',
      colIndex: 2,
      placement: { x: 25, y: 1, width: 48, height: 120 },
      name: 'col-2',
    },
    {
      kind: 'word-graph-doc-col',
      id: 'wg-doc-col-3',
      graphId: 'word-graph-1',
      placement: { x: 73, y: 1, width: 48, height: 120 },
      name: 'col-3',
    },
  ],
};

const result = await page.evaluate(async (layout) => {
  const r = await fetch('/api/layouts/graph-editor', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });
  return { status: r.status, ok: r.ok };
}, newLayout);

console.log('Result:', JSON.stringify(result));
await browser.close();
