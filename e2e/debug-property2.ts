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

// Get all root-level nodes
const rootNodes = await page.evaluate(() => {
  const list = document.querySelector('[data-outliner-list]');
  return [...(list?.querySelectorAll(':scope > [data-node-id]') ?? [])]
    .map(r => ({
      id: r.getAttribute('data-node-id') ?? '',
      text: (r.querySelector('textarea') as HTMLTextAreaElement | null)?.value ?? '',
    }));
});
log(`All root nodes: ${JSON.stringify(rootNodes)}`);

// Right-click each node and report what menu appears
for (const n of rootNodes) {
  const clicked = await page.evaluate((nid: string) => {
    const list = document.querySelector('[data-outliner-list]');
    const row = list?.querySelector(`[data-node-id="${nid}"]`);
    const btnWrap = row?.querySelector('[data-expand-marker]')?.parentElement;
    if (!btnWrap) return 'btnWrap not found';
    btnWrap.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
    return 'ok';
  }, n.id);

  await new Promise(r => setTimeout(r, 400));

  const menu = await page.evaluate(() => {
    const m = document.querySelector('[data-prop-menu]');
    if (!m) return null;
    return m.textContent?.slice(0, 200);
  });

  log(`Node "${n.text}" (${n.id.slice(0,8)}): click=${clicked}, menu=${JSON.stringify(menu)}`);

  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 100));
}

await b.close();
