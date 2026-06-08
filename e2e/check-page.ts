import { chromium } from '@playwright/test';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();
console.log('url:', page.url());
const inputs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('input')).map(i => ({ type: i.type, name: i.name, autocomplete: i.autocomplete, id: i.id, placeholder: i.placeholder }))
);
console.log('inputs:', JSON.stringify(inputs));
await page.screenshot({ path: '/tmp/current-state.png' });
process.exit(0);
