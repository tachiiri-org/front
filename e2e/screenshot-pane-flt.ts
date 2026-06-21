import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 5000));
await page.click('button:has-text("パネル")');
await new Promise(r => setTimeout(r, 2500));
// Click the filter area to open filter menu
await page.evaluate(() => {
  const flt = document.querySelector<HTMLElement>('[title="フィルタを設定"]');
  flt?.click();
});
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/pane-flt-menu.png' });
// Click debug_tag in filter menu
await page.evaluate(() => {
  const pills = [...document.querySelectorAll<HTMLElement>('span[style*="background"]')];
  const p = pills.find(s => s.textContent?.trim() === 'debug_tag');
  p?.click();
});
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/pane-flt-active.png' });
await b.close();
