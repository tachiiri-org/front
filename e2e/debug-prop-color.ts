import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const pw_ctx = b.contexts()[0];
const page = pw_ctx.pages()[0] ?? await pw_ctx.newPage();
const cdp = await page.context().newCDPSession(page);
const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);

await cdp.send('Page.navigate', { url: 'https://front-dev.tachiiri.workers.dev/graph-editor' });
await new Promise(r => setTimeout(r, 3000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2000));

// Check colors API
const colors = await page.evaluate(async () => {
  const r = await fetch('/api/v1/graph/word-graph-1/colors');
  return r.json();
});
log(`Colors API: ${JSON.stringify(colors)}`);

// Right-click first node
const nodeId = await page.evaluate(() =>
  document.querySelector('[data-outliner-list] [data-node-id]')?.getAttribute('data-node-id') ?? null
);
log(`First node: ${nodeId}`);

await page.evaluate((nid: string) => {
  const row = document.querySelector(`[data-outliner-list] [data-node-id="${nid}"]`);
  row?.querySelector('[data-expand-marker]')?.parentElement
    ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
}, nodeId!);
await new Promise(r => setTimeout(r, 500));

await page.screenshot({ path: '/tmp/prop-color-menu.png' });
log('screenshot saved: /tmp/prop-color-menu.png');

const menuText = await page.evaluate(() => document.querySelector('[data-prop-menu]')?.textContent?.slice(0, 300));
log(`Menu: ${menuText}`);

await b.close();
