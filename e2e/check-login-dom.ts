import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const BASE_URL = 'https://front-dev.tachiiri.workers.dev';

async function run() {
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  await page.goto(`${BASE_URL}/login?next=org_create`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => ({
    url: window.location.href,
    search: window.location.search,
    groupNameEl: document.getElementById('l-group-name')?.outerHTML ?? 'NOT FOUND',
    ctxEl: document.getElementById('l-ctx')?.outerHTML ?? 'NOT FOUND',
    groupNameVisible: (() => {
      const el = document.getElementById('l-group-name');
      if (!el) return 'element missing';
      return window.getComputedStyle(el).display;
    })(),
  }));

  console.log('URL:', info.url);
  console.log('search:', info.search);
  console.log('ctxEl:', info.ctxEl);
  console.log('groupName display:', info.groupNameVisible);
  console.log('groupName HTML:', info.groupNameEl.slice(0, 200));

  await page.screenshot({ path: '/tmp/login-dom-check.png' });
  await page.close();
  await browser.close();
}

run().catch(console.error);
