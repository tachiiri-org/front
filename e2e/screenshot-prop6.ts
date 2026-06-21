import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 4000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2500));
// Find the first row square (the node square that opens property menu)
const info = await page.evaluate(() => {
  const allSpans = [...document.querySelectorAll<HTMLSpanElement>('span')];
  const candidates = allSpans.filter(s => {
    const style = s.getAttribute('style') || '';
    return style.includes('border-radius:2px') && style.includes('cursor:pointer');
  });
  console.log('candidates count:', candidates.length);
  if (candidates[0]) {
    const r = candidates[0].getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2 };
  }
  return null;
});
console.log('sq info:', info);
if (info) {
  await page.mouse.click(info.x, info.y);
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: '/tmp/prop-menu-open.png' });
}
await b.close();
