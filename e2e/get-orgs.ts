import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTH_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth/state.json');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: AUTH_FILE });
const page = await context.newPage();
await page.goto('https://front-production.tachiiri.workers.dev/DB%20Apply', { waitUntil: 'networkidle' });
const options = await page.evaluate(() => {
  const sel = document.querySelector('select');
  return Array.from(sel?.options ?? []).map(o => ({ value: o.value, text: o.textContent?.trim() }));
});
console.log(JSON.stringify(options, null, 2));
await browser.close();
