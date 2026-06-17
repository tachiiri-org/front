import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
const CDP_PORT = 9222;
const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();
await page.goto('https://front-dev.tachiiri.workers.dev/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(2000);
await page.click('#l-tab-new-group');
await page.waitForTimeout(5000);
const info = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input[name="cf-turnstile-response"]'));
  return {
    siteKey: (window as unknown as Record<string, unknown>).__TURNSTILE_SITE_KEY__,
    tokenCount: inputs.length,
    hasToken: inputs.some(i => !!(i as HTMLInputElement).value),
    iframeCount: document.querySelectorAll('iframe').length,
  };
});
console.log(JSON.stringify(info));
const cdp = await context.newCDPSession(page);
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
await import('node:fs').then(fs => fs.writeFileSync('/tmp/login-turnstile.png', Buffer.from(data, 'base64')));
console.log('saved');
await browser.close();
