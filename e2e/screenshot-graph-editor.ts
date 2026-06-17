import { chromium } from '@playwright/test';

const CDP_PORT = 9222;

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:' + CDP_PORT);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  // Read BASE_URL from environment or use default dev URL
  const baseUrl = process.env.BASE_URL || 'https://dev.front.tachiiri.workers.dev';
  const target = baseUrl + '/graph-editor';
  console.log('navigating to:', target);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Check page state
  const title = await page.title();
  const url = page.url();
  console.log('title:', title);
  console.log('url:', url);

  // Get page body snippet
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? 'no body');
  console.log('body text:', bodyText);

  // Check for canvas elements
  const canvasCount = await page.evaluate(() => document.querySelectorAll('canvas').length);
  console.log('canvas elements:', canvasCount);

  // Try using CDP directly to capture screenshot
  const client = await context.newCDPSession(page);
  const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('fs');
  fs.writeFileSync('/tmp/graph-editor-dev.png', Buffer.from(data, 'base64'));
  console.log('saved to /tmp/graph-editor-dev.png');
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
