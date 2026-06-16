import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL, ensureAuthOnPage } from './session.ts';

const CDP_PORT = 9222;
const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const context = browser.contexts()[0];
const page = await context.newPage();
await ensureAuthOnPage(page, context);

// Navigate to Graph Explorer and capture the screen JSON request
const responses: Array<{url: string, body: string}> = [];
page.on('response', async (res) => {
  if (res.url().includes('screen') || res.url().includes('layout') || res.url().includes('graph')) {
    try {
      const body = await res.text();
      responses.push({ url: res.url(), body: body.slice(0, 300) });
    } catch {}
  }
});

await page.goto(`${BASE_URL}/Graph%20Explorer`, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(2000);
console.log('Responses:', JSON.stringify(responses, null, 2));
await browser.close();
