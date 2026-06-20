import { chromium } from '@playwright/test';

const b = await chromium.connectOverCDP('http://localhost:9222');
const pw_ctx = b.contexts()[0];
const page = pw_ctx.pages()[0] ?? await pw_ctx.newPage();
const cdp = await page.context().newCDPSession(page);

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);

// Navigate to dev outliner
await cdp.send('Page.navigate', { url: 'https://front-dev.tachiiri.workers.dev/graph-editor' });
await new Promise(r => setTimeout(r, 3000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2000));

// Pick first node from outliner (not column view)
const outlinerInfo = await page.evaluate(() => {
  const list = document.querySelector('[data-outliner-list]');
  const row = list?.querySelector('[data-node-id]');
  const marker = row?.querySelector('[data-expand-marker]');
  return {
    nodeId: row?.getAttribute('data-node-id') ?? null,
    hasMarker: !!marker,
    markerParentTag: marker?.parentElement?.tagName ?? null,
    rowText: row?.textContent?.slice(0, 30) ?? null,
    listFound: !!list,
  };
});
log(`Outliner info: ${JSON.stringify(outlinerInfo)}`);

if (!outlinerInfo.nodeId) {
  log('ERROR: no node found in outliner list');
  await b.close();
  process.exit(1);
}

const nodeId = outlinerInfo.nodeId;

// ── Test 1: right-click to open property menu ──────────────────────────
const rightClick1 = await page.evaluate((nid: string) => {
  const list = document.querySelector('[data-outliner-list]');
  const row = list?.querySelector(`[data-node-id="${nid}"]`);
  const marker = row?.querySelector('[data-expand-marker]');
  const btnWrap = marker?.parentElement;
  if (!btnWrap) return { ok: false, reason: `marker not found. row=${!!row}` };
  const rect = btnWrap.getBoundingClientRect();
  btnWrap.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, clientX: rect.x + 5, clientY: rect.y + 5,
  }));
  return { ok: true };
}, nodeId);
log(`Right-click 1: ${JSON.stringify(rightClick1)}`);
await new Promise(r => setTimeout(r, 500));

const menu1 = await page.evaluate(() => {
  const m = document.querySelector('[data-prop-menu]');
  return m ? { found: true, text: m.textContent?.slice(0, 100) } : { found: false };
});
log(`Menu 1: ${JSON.stringify(menu1)}`);

// ── Test 2: add a property via the menu's input ───────────────────────
if (menu1.found) {
  const added = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('[data-prop-menu] input');
    if (!input) return 'input not found';
    input.value = 'テスト';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Hit Enter
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const m = document.querySelector('[data-prop-menu]');
    return m?.textContent?.slice(0, 100) ?? 'menu gone';
  });
  log(`After adding property: ${added}`);
} else {
  // Fallback: add via API directly
  log('Menu not found, adding via API...');
  const apiResult = await page.evaluate(async (nid: string) => {
    const r = await fetch('/api/v1/graph/word-graph-1/node/' + nid + '/property', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'テスト', value: '●' }),
    });
    return { status: r.status, body: await r.text() };
  }, nodeId);
  log(`API add: ${JSON.stringify(apiResult)}`);
}

// Close menu
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 200));

// ── Test 3: open menu again, check the property shows ─────────────────
const rightClick2 = await page.evaluate((nid: string) => {
  const list = document.querySelector('[data-outliner-list]');
  const row = list?.querySelector(`[data-node-id="${nid}"]`);
  const marker = row?.querySelector('[data-expand-marker]');
  const btnWrap = marker?.parentElement;
  if (!btnWrap) return { ok: false, reason: 'marker not found (check 2)' };
  btnWrap.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
  return { ok: true };
}, nodeId);
log(`Right-click 2: ${JSON.stringify(rightClick2)}`);
await new Promise(r => setTimeout(r, 500));

const menu2 = await page.evaluate(() => {
  const m = document.querySelector('[data-prop-menu]');
  return m ? { found: true, text: m.textContent?.slice(0, 200) } : { found: false };
});
log(`Menu 2 (same node, same session): ${JSON.stringify(menu2)}`);
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 200));

// ── Test 4: reload and check persistence ──────────────────────────────
log('--- Reloading page ---');
await cdp.send('Page.navigate', { url: 'https://front-dev.tachiiri.workers.dev/graph-editor' });
await new Promise(r => setTimeout(r, 3000));
await page.click('button:has-text("アウトライン")');
await new Promise(r => setTimeout(r, 2000));

const rightClick3 = await page.evaluate((nid: string) => {
  const list = document.querySelector('[data-outliner-list]');
  const row = list?.querySelector(`[data-node-id="${nid}"]`);
  const marker = row?.querySelector('[data-expand-marker]');
  const btnWrap = marker?.parentElement;
  if (!btnWrap) return { ok: false, reason: `marker not found. row=${!!row}, list=${!!list}` };
  btnWrap.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
  return { ok: true };
}, nodeId);
log(`Right-click 3 (after reload): ${JSON.stringify(rightClick3)}`);
await new Promise(r => setTimeout(r, 500));

const menu3 = await page.evaluate(() => {
  const m = document.querySelector('[data-prop-menu]');
  return m ? { found: true, text: m.textContent?.slice(0, 200) } : { found: false };
});
log(`Menu 3 (after reload): ${JSON.stringify(menu3)}`);

// ── Test 5: check API returned properties after reload ─────────────────
const apiCheck = await page.evaluate(async (nid: string) => {
  const r = await fetch('/api/v1/graph/word-graph-1/node/6427e286-9195-4826-8498-6a79a5c29fb7/children?limit=50');
  const data = await r.json() as any;
  const n = data.nodes?.find((x: any) => x.id === nid);
  return { nodeInResponse: n };
}, nodeId);
log(`API check after reload: ${JSON.stringify(apiCheck)}`);

await b.close();
