import { chromium } from '@playwright/test';
const AUTH_FILE = '/home/tachiiri/project/front/e2e/.auth/front-production-tachiiri-workers-dev.json';
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: AUTH_FILE });
const page = await ctx.newPage();
const res = await page.goto('https://front-production.tachiiri.workers.dev/api/auth/status');
console.log(JSON.stringify(await res!.json(), null, 2));
await browser.close();
