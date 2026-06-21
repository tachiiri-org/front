import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 3000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2000));
const clicked = await page.evaluate(() => {
  const tris = [...document.querySelectorAll('[data-expand-triangle]')] as HTMLElement[];
  const visible = tris.find(t => t.style.opacity !== '0');
  if (visible) { visible.click(); return true; }
  return false;
});
console.log('triangle clicked:', clicked);
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: '/tmp/outliner-expanded.png' });
await b.close();
