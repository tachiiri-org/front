import { chromium } from '@playwright/test';

const b = await chromium.connectOverCDP('http://localhost:9222');
const pw_ctx = b.contexts()[0];
const page = pw_ctx.pages()[0] ?? await pw_ctx.newPage();
const cdp = await page.context().newCDPSession(page);

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);

const gotoOutliner = async () => {
  await cdp.send('Page.navigate', { url: 'https://front-dev.tachiiri.workers.dev/graph-editor' });
  await new Promise(r => setTimeout(r, 3000));
  await page.click('button:has-text("アウトライン")');
  await new Promise(r => setTimeout(r, 2000));
};

const rightClickNode = async (nodeId: string) => {
  return page.evaluate((nid: string) => {
    const list = document.querySelector('[data-outliner-list]');
    const row = list?.querySelector(`[data-node-id="${nid}"]`);
    const marker = row?.querySelector('[data-expand-marker]');
    const btnWrap = marker?.parentElement;
    if (!btnWrap) return { ok: false, reason: `not in outliner. row=${!!row}` };
    btnWrap.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
    return { ok: true };
  }, nodeId);
};

const readMenu = async () => page.evaluate(() => {
  const m = document.querySelector('[data-prop-menu]');
  return m ? m.textContent?.slice(0, 300) : null;
});

const closeMenu = async () => {
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 100));
};

const expandNode = async (nodeId: string) => {
  return page.evaluate((nid: string) => {
    const list = document.querySelector('[data-outliner-list]');
    const row = list?.querySelector(`[data-node-id="${nid}"]`);
    const btnWrap = row?.querySelector('[data-expand-marker]')?.parentElement;
    if (!btnWrap) return 'btnWrap not found';
    btnWrap.click();
    return 'clicked';
  }, nodeId);
};

// ── PART 1: Basic persistence ─────────────────────────────────────────
log('=== PART 1: Basic persistence ===');
await gotoOutliner();

// Get all root-level nodes
const rootNodes = await page.evaluate(() => {
  const list = document.querySelector('[data-outliner-list]');
  return [...(list?.querySelectorAll(':scope > [data-node-id]') ?? [])].slice(0, 3)
    .map(r => ({ id: r.getAttribute('data-node-id') ?? '', text: (r.querySelector('textarea') as HTMLTextAreaElement | null)?.value ?? '' }));
});
log(`Root nodes (first 3): ${JSON.stringify(rootNodes)}`);

if (rootNodes.length === 0) { log('ERROR: no root nodes'); await b.close(); process.exit(1); }

const target = rootNodes[0];
log(`Target: ${target.id} "${target.text}"`);

// Open menu and check props
await rightClickNode(target.id);
await new Promise(r => setTimeout(r, 400));
const menu1 = await readMenu();
log(`Menu on first visit: ${menu1}`);
await closeMenu();

// ── PART 2: Properties after reload ───────────────────────────────────
log('=== PART 2: After reload ===');
await gotoOutliner();
await rightClickNode(target.id);
await new Promise(r => setTimeout(r, 400));
const menuAfterReload = await readMenu();
log(`Menu after reload: ${menuAfterReload}`);
await closeMenu();

// ── PART 3: Cross-hierarchy sharing ───────────────────────────────────
// The same node can appear as child of multiple parents.
// Expand first root node, then check if a child has the same props
// visible from a different parent.
log('=== PART 3: Cross-hierarchy ===');

// Expand the target node to see its children
const expandResult = await expandNode(target.id);
log(`Expand result: ${expandResult}`);
await new Promise(r => setTimeout(r, 1000));

// Get one child
const children = await page.evaluate((nid: string) => {
  const list = document.querySelector('[data-outliner-list]');
  const parentRow = list?.querySelector(`[data-node-id="${nid}"]`);
  // Children should come after the parent row in DOM
  const allRows = [...(list?.querySelectorAll('[data-node-id]') ?? [])];
  const idx = allRows.findIndex(r => r.getAttribute('data-node-id') === nid);
  return allRows.slice(idx + 1, idx + 3).map(r => ({
    id: r.getAttribute('data-node-id') ?? '',
    text: (r.querySelector('textarea') as HTMLTextAreaElement | null)?.value ?? '',
  }));
}, target.id);
log(`Children: ${JSON.stringify(children)}`);

// Set a property on the first child via API
if (children[0]) {
  const childId = children[0].id;
  const setProp = await page.evaluate(async (nid: string) => {
    const r = await fetch('/api/v1/graph/word-graph-1/node/' + nid + '/property', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'cross_test', value: '●' }),
    });
    return r.status;
  }, childId);
  log(`Set cross_test on child ${childId}: status ${setProp}`);

  // Now collapse the parent and reload to clear cache, then expand a different parent
  // that also contains this child
  // For simplicity: just check that the child menu shows the property via API
  // even without having expanded from THIS path (simulate by clearing cache & re-expanding)

  // Right-click the child now (it's visible from current expansion)
  await rightClickNode(childId);
  await new Promise(r => setTimeout(r, 400));
  const childMenu = await readMenu();
  log(`Child menu (same session, before reload): ${childMenu}`);
  await closeMenu();

  // Reload and check
  log('--- reload for cross-hierarchy test ---');
  await gotoOutliner();

  // The child won't be visible until we expand the parent
  const expandResult2 = await expandNode(target.id);
  log(`Expand result 2: ${expandResult2}`);
  await new Promise(r => setTimeout(r, 1000));

  await rightClickNode(childId);
  await new Promise(r => setTimeout(r, 400));
  const childMenuAfterReload = await readMenu();
  log(`Child menu after reload (loaded via parent expand): ${childMenuAfterReload}`);
  await closeMenu();

  // Check: if another root-level node in the list that IS the same node
  // would have properties even without expanding its parent.
  // This tests propStore seeding from load() for top-level nodes.
  log('=== Checking propStore seeding from load() ===');
  const propStoreForChild = await page.evaluate((nid: string) => {
    // Check if child appears in root list or only after expand
    const list = document.querySelector('[data-outliner-list]');
    const allRows = [...(list?.querySelectorAll('[data-node-id]') ?? [])];
    const found = allRows.find(r => r.getAttribute('data-node-id') === nid);
    return { isVisible: !!found };
  }, childId);
  log(`Child visible in outliner: ${JSON.stringify(propStoreForChild)}`);
}

log('=== ALL TESTS DONE ===');
await b.close();
