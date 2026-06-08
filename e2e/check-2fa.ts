import { chromium } from '@playwright/test';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();
console.log('url:', page.url());

// ボタンとリンク一覧
const btns = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button, a')).map(el => ({
    tag: el.tagName, text: el.textContent?.trim().slice(0, 80), href: (el as HTMLAnchorElement).href
  }))
);
console.log('buttons/links:', JSON.stringify(btns, null, 2));
process.exit(0);
