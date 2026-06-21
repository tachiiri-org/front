import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 5000));
await page.click('button:has-text("パネル")');
await new Promise(r => setTimeout(r, 2500));
// Open filter menu on pane 1
await page.evaluate(() => {
  const areas = [...document.querySelectorAll<HTMLElement>('[title="フィルタを設定"]')];
  areas[0]?.click();
});
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/filter-menu-final.png' });
await b.close();
