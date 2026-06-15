import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor', { waitUntil: 'networkidle' });

const info = await page.evaluate(() => {
  const vp = { w: window.innerWidth, h: window.innerHeight };
  const canvas = document.querySelector('[style*="grid-template-columns"]') as HTMLElement | null;
  const canvasRect = canvas ? canvas.getBoundingClientRect() : null;
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  return {
    viewport: vp,
    isMobile,
    canvasGrid: canvas ? window.getComputedStyle(canvas).gridTemplateColumns.slice(0, 100) : null,
    canvasW: canvasRect ? Math.round(canvasRect.width) : null,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
