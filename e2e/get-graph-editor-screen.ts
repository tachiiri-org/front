import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

await page.goto(`${BASE_URL}/graph-editor`);
await page.waitForLoadState('networkidle');

const res = await page.evaluate(async () => {
  // GET /api/layouts/{name} returns the full screen JSON
  const r = await fetch('/api/layouts/graph-editor');
  const screen = r.ok ? await r.json() : { error: r.status };
  return screen;
});

console.log(JSON.stringify(res, null, 2));
