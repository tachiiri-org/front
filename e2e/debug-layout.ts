import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor', { waitUntil: 'networkidle' });

const info = await page.evaluate(() => {
  const frames = Array.from(document.querySelectorAll('[data-frame-id]')) as HTMLElement[];
  return frames.map((f) => {
    const rect = f.getBoundingClientRect();
    return {
      id: f.dataset.frameId,
      gridColumn: f.style.gridColumn,
      gridRow: f.style.gridRow,
      bg: f.style.background,
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      x: Math.round(rect.x),
      overflow: f.style.overflow,
      display: f.style.display,
      childCount: f.children.length,
      firstChildText: f.firstElementChild?.textContent?.slice(0, 80) ?? '',
    };
  });
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
