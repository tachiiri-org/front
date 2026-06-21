import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0];
const page = ctx.pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 5000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 3000));
// Screenshot current state first
await page.screenshot({ path: '/tmp/before-click.png', fullPage: false });
// Find node rows
const rows = await page.locator('[data-node-id]').all();
console.log('rows found:', rows.length);
if (rows.length > 0) {
  const box = await rows[0].boundingBox();
  console.log('row0 box:', box);
  if (box) {
    await page.mouse.click(box.x + 10, box.y + box.height/2);
    await new Promise(r => setTimeout(r, 800));
    await page.screenshot({ path: '/tmp/prop-menu-open.png' });
  }
}
await b.close();
