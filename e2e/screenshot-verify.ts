import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 5000));
await page.click('button:has-text("パネル")');
await new Promise(r => setTimeout(r, 2500));
// Add 2nd pane and set source to pane 1
await page.click('button[title="列を追加"]');
await new Promise(r => setTimeout(r, 400));
// Set pane 2 source to pane 1 via source button
const srcBtns = await page.$$('span:has-text("ルート"), button:has-text("ルート")');
console.log('srcBtns count:', srcBtns.length);
// Click filter area on pane 1 to add a filter
await page.evaluate(() => {
  const areas = [...document.querySelectorAll<HTMLElement>('[title="フィルタを設定"]')];
  areas[0]?.click();
});
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: '/tmp/flt-menu.png' });
// Click debug_tag to add filter
await page.evaluate(() => {
  const menus = document.querySelectorAll<HTMLElement>('[data-pane-flt-menu] span[style*="background"]');
  const p = [...menus].find(s => s.textContent?.trim() === 'debug_tag');
  p?.click();
});
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: '/tmp/flt-active.png' });
await b.close();
