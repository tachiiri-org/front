import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const TARGET = 'https://front-dev.tachiiri.workers.dev';

const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const contexts = browser.contexts();
const ctx = contexts[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

await page.goto(`${TARGET}/graph-editor`);
await page.waitForTimeout(3000);

await page.screenshot({ path: '/tmp/draft-before.png' });
console.log('=== Before click ===');

// Check draft state before clicking
const before = await page.evaluate(() => {
  const d = document.querySelector('textarea[data-nav-input="draft"][data-column-index="2"]') as HTMLTextAreaElement | null;
  if (!d) return { found: false };
  const rect = d.getBoundingClientRect();
  return {
    found: true,
    disabled: d.disabled,
    opacity: window.getComputedStyle(d).opacity,
    pointerEvents: window.getComputedStyle(d).pointerEvents,
    parentOpacity: window.getComputedStyle(d.parentElement!).opacity,
    rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    placeholder: d.placeholder,
  };
});
console.log('Draft state:', JSON.stringify(before, null, 2));

// Try clicking it
if (before.found) {
  const draft = page.locator('textarea[data-nav-input="draft"][data-column-index="2"]').first();
  try {
    await draft.click({ timeout: 3000 });
    console.log('Click succeeded');
  } catch (e) {
    console.log('Click failed:', String(e).slice(0, 200));
  }

  await page.screenshot({ path: '/tmp/draft-after-click.png' });

  const active = await page.evaluate(() => ({
    tag: (document.activeElement as HTMLElement)?.tagName,
    navInput: (document.activeElement as HTMLElement)?.dataset?.navInput,
    colIndex: (document.activeElement as HTMLElement)?.dataset?.columnIndex,
  }));
  console.log('Active element after click:', JSON.stringify(active));
}
