import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { ensureAuthOnPage } from './session.ts';

async function main() {
  const devUrl = 'https://front-dev.tachiiri.workers.dev';
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  await ensureAuthOnPage(page, context);
  await page.goto(`${devUrl}/graph-editor`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 1. Check no italic textareas (word graph uses textarea, not input)
  const italicCount = await page.evaluate(() =>
    Array.from(document.querySelectorAll('textarea')).filter(
      ta => getComputedStyle(ta).fontStyle === 'italic'
    ).length
  );
  const totalTextareas = await page.evaluate(() => document.querySelectorAll('textarea').length);
  console.log(`Textareas: ${totalTextareas} total, ${italicCount} italic (expect 0)`);

  // Screenshot
  await page.screenshot({ path: '/tmp/ss-ge-before.png' });

  // 2. Find a textarea with value
  const firstWithValue = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('textarea'));
    const ta = all.find(t => t.value.length > 0);
    return ta ? ta.value.slice(0, 30) : null;
  });
  console.log('First textarea with value:', firstWithValue);

  // 3. Nav race condition: navigate away and back quickly
  await page.goto(`${devUrl}/DB%20Apply`, { waitUntil: 'domcontentloaded' });
  await page.goto(`${devUrl}/graph-editor`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/ss-ge-after-nav.png' });

  const navChildren = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    return nav ? nav.children.length : -1;
  });
  console.log(`Nav children after rapid navigation: ${navChildren} (expect > 0)`);

  console.log('Done');
}

main().catch(console.error);
