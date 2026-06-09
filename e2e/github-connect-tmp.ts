import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

// Check all 3 environments
for (const env of ['production', 'stage', 'dev']) {
  const base = `https://front-${env}.tachiiri.workers.dev`;
  await page.goto(`${base}/oauth/github/connect/start?scope=repo+read%3Auser&returnTo=%2Fdb-migrate`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  
  const response = await page.request.get(`${base}/api/admin/db-apply/status`);
  const body = await response.json() as {userDbs: Array<{label: string, applied: number, pendingExpand: string[]}>};
  console.log(`\n=== ${env} ===`);
  for (const db of body.userDbs ?? []) {
    console.log(`  ${db.label}: applied=${(db as unknown as {applied: string[]}).applied?.length}, pendingExpand=${db.pendingExpand?.length}`);
    if (db.pendingExpand?.length > 0) console.log('  PENDING:', db.pendingExpand);
  }
}

await browser.close();
