import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const DEV_URL = 'https://front-dev.tachiiri.workers.dev';
const STAGE_URL = 'https://front-stage.tachiiri.workers.dev';

async function applyIdentityExpand(label: string, baseUrl: string, page: Awaited<ReturnType<typeof import('@playwright/test').chromium.connectOverCDP>>['contexts'][0]['pages'][0]) {
  console.log(`\n=== Apply identity/expand on ${label} ===`);
  await page.goto(`${baseUrl}/`);
  const res = await page.evaluate(async (url) => {
    const r = await fetch(`${url}/api/admin/db-apply/identity/expand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    const text = await r.text();
    return { status: r.status, body: text };
  }, baseUrl);
  console.log(`HTTP ${res.status}: ${res.body.slice(0, 600)}`);
  return res.status;
}

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = await context.newPage();

  // Step 1: Check dev status first
  console.log('=== Step 1: Check current dev db-apply status ===');
  await page.goto(`${DEV_URL}/`);
  const statusRes = await page.evaluate(async (url) => {
    const r = await fetch(`${url}/api/admin/db-apply/status`, { credentials: 'include' });
    const text = await r.text();
    return { status: r.status, body: text.slice(0, 500) };
  }, DEV_URL);
  console.log(`Status HTTP ${statusRes.status}: ${statusRes.body}`);

  // Step 2: Apply on dev
  await applyIdentityExpand('dev', DEV_URL, page);

  // Step 3: Apply on stage
  await applyIdentityExpand('stage', STAGE_URL, page);

  await page.close();
  await browser.close();
}

main().catch(console.error);
