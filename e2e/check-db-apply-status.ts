import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0];
const res = await page.evaluate(async (base: string) => {
  const r = await fetch(`${base}/api/admin/db-apply/status`);
  return r.ok ? await r.json() as unknown : { error: r.status };
}, BASE_URL);
console.log(JSON.stringify(res, null, 2));
await browser.close();
