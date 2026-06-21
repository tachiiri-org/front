import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 5000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 3000));
// Find all squares and click one to open prop menu
const squares = await page.evaluate(() => {
  const sqs = [...document.querySelectorAll<HTMLElement>('span')].filter(s => {
    const st = s.getAttribute('style') || '';
    return st.includes('width: 6px') && st.includes('height: 6px');
  });
  return sqs.map((s, i) => {
    const r = s.getBoundingClientRect();
    return { i, left: r.left, top: r.top, width: r.width, height: r.height };
  }).filter(r => r.top > 0 && r.left > 0);
});
console.log('squares:', squares.slice(0, 5));
if (squares.length > 0) {
  const s = squares[0];
  await page.mouse.click(s.left + s.width/2, s.top + s.height/2);
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: '/tmp/prop-menu-v2.png' });
}
await b.close();
