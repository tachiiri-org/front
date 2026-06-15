import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor', { waitUntil: 'networkidle' });

const result = await page.evaluate(() => {
  const el = document.getElementById('__screen_data__');
  if (!el) return { found: false, textLen: 0, text: '' };
  return { found: true, textLen: el.textContent?.length ?? 0, text: el.textContent?.slice(0, 500) ?? '' };
});
console.log('Screen data element:', JSON.stringify(result, null, 2));

const domResult = await page.evaluate(() => {
  const frames = Array.from(document.querySelectorAll('[data-frame-id]'));
  return {
    frameCount: frames.length,
    frameKinds: frames.map((f) => `${(f as HTMLElement).dataset.frameId} graphId=${(f as HTMLElement).dataset.graphId ?? 'none'}`),
  };
});
console.log('DOM frames:', JSON.stringify(domResult, null, 2));

await browser.close();
