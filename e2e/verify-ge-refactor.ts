import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import * as fs from 'fs';
import { ensureAuthOnPage } from './session.ts';

// Read-only interaction verification for the graph-editor module refactor.
// Drives focus/navigation/lang-switch/fallback/arrow-nav — every code path EXCEPT
// the graph-mutating ones (create/delete/link-persist), which we must not run against
// the curated graph. Captures pageerror to catch any undefined ctx callback.

const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();
await ensureAuthOnPage(page, ctx); // BASE_URL must be set to the dev origin
const cdp = await page.context().newCDPSession(page);
const shot = async (p: string) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(p, Buffer.from(data, 'base64'));
};

const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

const log = (s: string) => console.log(s);

await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// 1. Initial load — col0 bookmarks rendered
const col0 = await page.evaluate(() => document.querySelectorAll('[data-col-index="0"] textarea[data-node-id]').length);
log(`[1] col0 nodes: ${col0}`);
await shot('/tmp/ge-1-load.png');

// 2. Focus first col0 node → onNodeFocus → loadColumn(child) → next column builds
await page.evaluate(() => {
  const t = document.querySelector<HTMLTextAreaElement>('[data-col-index="0"] textarea[data-node-id]');
  t?.focus();
});
await page.waitForTimeout(2500);
const colCount = await page.evaluate(() => document.querySelectorAll('[data-col-index]').length);
const col1 = await page.evaluate(() => document.querySelectorAll('[data-col-index="1"] textarea[data-node-id]').length);
log(`[2] after focus: columns=${colCount}, col1 nodes=${col1}`);

// 3. Breadcrumb updated (refreshBreadcrumb)
const crumb = await page.evaluate(() => {
  const el = document.querySelector('div');
  // breadcrumb is the element containing 'ルート'
  const all = Array.from(document.querySelectorAll('div'));
  const bc = all.find((d) => d.textContent?.startsWith('ルート') && d.querySelectorAll('span').length > 0);
  return bc?.textContent ?? null;
});
log(`[3] breadcrumb: ${JSON.stringify(crumb)}`);

// 4. Link-source dimming applied (setLinkSource → refreshAllNodeText): some textareas dimmed
const dim = await page.evaluate(() => {
  const tas = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[data-node-id]'));
  const colors = new Set(tas.map((t) => t.style.color));
  return { total: tas.length, distinctColors: [...colors] };
});
log(`[4] textarea dimming: ${JSON.stringify(dim)}`);
await shot('/tmp/ge-2-focus.png');

// 5. Language switch EN (switchLang → loadColumn) then back to JA
const clickByText = (txt: string) => page.evaluate((t) => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === t);
  btn?.click();
}, txt);
await clickByText('EN');
await page.waitForTimeout(2500);
const col0en = await page.evaluate(() => document.querySelectorAll('[data-col-index="0"] textarea[data-node-id]').length);
log(`[5] after EN switch: col0 nodes=${col0en}`);
await shot('/tmp/ge-3-en.png');
await clickByText('JA');
await page.waitForTimeout(2000);

// 6. Fallback toggle (他言語) → loadColumn, then toggle back
await clickByText('他言語');
await page.waitForTimeout(2000);
const col0fb = await page.evaluate(() => document.querySelectorAll('[data-col-index="0"] textarea[data-node-id]').length);
log(`[6] after fallback ON: col0 nodes=${col0fb}`);
await clickByText('他言語');
await page.waitForTimeout(1500);

// 7. Arrow-key navigation (keyboard.ts ArrowDown at end → next textarea)
const navMoved = await page.evaluate(async () => {
  const tas = Array.from(document.querySelectorAll<HTMLTextAreaElement>('[data-col-index="0"] textarea[data-node-id]'));
  if (tas.length < 2) return 'too few nodes';
  const first = tas[0];
  first.focus();
  first.setSelectionRange(first.value.length, first.value.length);
  const beforeId = (document.activeElement as HTMLElement)?.dataset.nodeId;
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const afterId = (document.activeElement as HTMLElement)?.dataset.nodeId;
  return { beforeId, afterId, moved: beforeId !== afterId };
});
log(`[7] arrow-down nav: ${JSON.stringify(navMoved)}`);

log(`\n=== pageerrors/console.errors: ${errors.length} ===`);
for (const e of errors) log(`  ${e}`);
log(errors.length === 0 ? 'RESULT: clean' : 'RESULT: ERRORS PRESENT');

await b.close();
