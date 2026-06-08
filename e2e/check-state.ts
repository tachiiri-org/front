import { chromium } from '@playwright/test';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();
await page.screenshot({ path: '/tmp/current.png', fullPage: true });
const html = await page.locator('body').innerHTML().catch(() => '');
console.log('url:', page.url());
console.log('body snippet:', html.slice(0, 500));
await browser.disconnect();
