import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 5000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 3000));
// Click node square on first row to open property menu
await page.mouse.click(43, 90);
await new Promise(r => setTimeout(r, 800));
// Type "test_prop" and press Enter to create
await page.keyboard.type('test_prop');
await page.keyboard.press('Enter');
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: '/tmp/after-add-prop.png' });
// Switch to pane mode
await page.keyboard.press('Escape');
await page.click('button:has-text("パネル")');
await new Promise(r => setTimeout(r, 2000));
// Open filter menu on pane 1
const fltInfo = await page.evaluate(() => {
  const flt = document.querySelector<HTMLElement>('[title="フィルタを設定"]');
  if (!flt) return null;
  const r = flt.getBoundingClientRect();
  return { left: r.left, top: r.top, w: r.width, h: r.height };
});
if (fltInfo && fltInfo.w > 0) {
  await page.mouse.click(fltInfo.left + fltInfo.w/2, fltInfo.top + fltInfo.h/2);
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: '/tmp/pane-flt-with-prop.png' });
}
await b.close();
