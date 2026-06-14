import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { ensureAuthOnPage } from './session.ts';

const BASE_URL = 'https://front-dev.tachiiri.workers.dev';

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  await ensureAuthOnPage(page, context);

  await page.goto(`${BASE_URL}/DB%20Apply`, { waitUntil: 'networkidle' });
  console.log('url:', page.url());
  const text = await page.evaluate(() => document.body.innerText.slice(0, 6000));
  console.log('=== DB Apply ===\n', text);
  await page.screenshot({ path: '/tmp/db-apply-dev2.png', fullPage: true });
  await page.close();
}

main().catch(e => { console.error(e); process.exit(1); });
