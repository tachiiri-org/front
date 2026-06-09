import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

const apiCalls: string[] = [];
page.on('response', async (res) => {
  const url = res.url();
  if (url.includes('/api/graph')) {
    try {
      const json = await res.json();
      apiCalls.push(`${res.status()} ${url}\n${JSON.stringify(json).slice(0, 500)}`);
    } catch {
      apiCalls.push(`${res.status()} ${url} (non-json)`);
    }
  }
});

await page.goto(`${BASE_URL}/graph-editor`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

console.log('=== API calls ===');
for (const c of apiCalls) console.log(c, '\n---');

await browser.close();
