import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 5000));
await page.click('button:has-text("パネル")');
await new Promise(r => setTimeout(r, 3000));
// Find the filter area via evaluate
const fltInfo = await page.evaluate(() => {
  const flt = document.querySelector<HTMLElement>('[title="フィルタを設定"]');
  if (!flt) { console.log('not found'); return null; }
  const r = flt.getBoundingClientRect();
  console.log('flt rect:', r.left, r.top, r.width, r.height);
  return { left: r.left, top: r.top, w: r.width, h: r.height };
});
console.log('flt:', fltInfo);
if (fltInfo && fltInfo.w > 0) {
  await page.mouse.click(fltInfo.left + fltInfo.w/2, fltInfo.top + fltInfo.h/2);
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: '/tmp/pane-flt-v3.png' });
}
await b.close();
