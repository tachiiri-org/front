import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const DEV_URL = 'https://front-dev.tachiiri.workers.dev';

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  
  // Create a new page for dev testing
  const page = await context.newPage();
  await page.goto(`${DEV_URL}/api/auth/status`);
  const status = await page.evaluate(() => document.body.innerText);
  console.log('Dev auth status:', status.slice(0, 200));
  
  // Try migration calls (may fail with 401 if not authenticated)
  for (const [label, endpoint, target] of [
    ['identity→dev', '/api/admin/migration/identity', 'dev'],
    ['r2-layouts→dev', '/api/admin/migration/r2-layouts', 'dev'],
  ] as const) {
    console.log(`\n=== ${label} ===`);
    await page.goto(`${DEV_URL}/`);
    const res = await page.evaluate(async ([base, ep, t]) => {
      const r = await fetch(base + ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: t }),
        credentials: 'include',
      });
      const text = await r.text();
      return { status: r.status, body: text };
    }, [DEV_URL, endpoint, target] as [string, string, string]);
    console.log(`HTTP ${res.status}: ${res.body.slice(0, 500)}`);
  }
  
  await page.close();
  await browser.close();
}

main().catch(console.error);
