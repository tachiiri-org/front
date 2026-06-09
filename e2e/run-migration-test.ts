import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  await page.goto(`${BASE_URL}/Migration%20Admin`);
  await page.waitForLoadState('networkidle');

  for (const [label, endpoint, target] of [
    ['identity→stage', '/api/admin/migration/identity', 'stage'],
    ['r2-layouts→stage', '/api/admin/migration/r2-layouts', 'stage'],
    ['identity→dev', '/api/admin/migration/identity', 'dev'],
    ['r2-layouts→dev', '/api/admin/migration/r2-layouts', 'dev'],
  ] as const) {
    console.log(`\n=== ${label} ===`);
    const res = await page.evaluate(async ([ep, t]) => {
      const r = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: t }),
      });
      const text = await r.text();
      return { status: r.status, body: text };
    }, [endpoint, target] as [string, string]);
    console.log(`HTTP ${res.status}: ${res.body.slice(0, 1000)}`);
  }

  await browser.close();
}

main().catch(console.error);
