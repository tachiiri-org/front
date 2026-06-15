import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

await page.setViewportSize({ width: 1280, height: 800 });
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor', { waitUntil: 'networkidle' });
await page.screenshot({ path: '/tmp/graph-editor-desktop.png', fullPage: false });
await browser.close();
console.log('saved: /tmp/graph-editor-desktop.png');
