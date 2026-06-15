import { chromium } from '@playwright/test';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();
await page.goto('https://front-dev.tachiiri.workers.dev/api/auth/status', { waitUntil: 'networkidle' });

const body = await page.evaluate(() => document.body.innerText);
console.log('Auth status:', body.slice(0, 300));

// Also check what tenant we're in
const orgInfo = await page.evaluate(async () => {
  const r = await fetch('/api/auth/status');
  return { status: r.status, body: await r.text() };
});
console.log('Auth API:', orgInfo.status, orgInfo.body.slice(0, 300));

await browser.close();
