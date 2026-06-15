import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = await context.newPage();

const errors: string[] = [];
const requests: string[] = [];

page.on('console', msg => {
  if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
});
page.on('response', async resp => {
  if (!resp.ok() && resp.url().includes('tachiiri')) {
    const body = await resp.text().catch(() => '');
    errors.push(`HTTP ${resp.status()} ${resp.url()} — ${body.slice(0, 300)}`);
  }
  if (resp.url().includes('/api/graph')) {
    requests.push(`${resp.request().method()} ${resp.url()} → ${resp.status()}`);
  }
});

// Hard-reload (bypass cache)
await page.goto(`${BASE_URL}/graph-editor`, { waitUntil: 'networkidle' });
await new Promise<void>(r => setTimeout(r, 2000));
await page.screenshot({ path: '/tmp/initial-load.png' });

// Click first word
const firstWord = page.locator('[data-column-index="1"][data-nav-input="node"]').first();
if (await firstWord.count() === 0) {
  errors.push('No words visible in col1');
} else {
  await firstWord.click();
  await new Promise<void>(r => setTimeout(r, 1000));

  const textNodes = page.locator('[data-column-index="2"][data-nav-input="node"]');
  const cnt = await textNodes.count();
  console.log('text nodes visible:', cnt);

  if (cnt > 0) {
    await textNodes.first().click();
    await new Promise<void>(r => setTimeout(r, 1500));
    await page.screenshot({ path: '/tmp/after-text-selected.png' });

    const docTA = page.locator('[data-frame-id="wg-doc-col-3"] textarea').first();
    if (await docTA.count() > 0) {
      await docTA.click();
      await docTA.fill('エラー確認テスト');
      await docTA.press('Enter');
      await new Promise<void>(r => setTimeout(r, 3000));
      await page.screenshot({ path: '/tmp/after-save.png' });
    } else {
      errors.push('textarea not found in doc col after text selected');
      await page.screenshot({ path: '/tmp/no-textarea.png' });
    }
  }
}

console.log('\n=== ERRORS ===');
if (errors.length === 0) console.log('(none)');
errors.forEach(e => console.log(e));
console.log('\n=== API requests ===');
requests.forEach(r => console.log(r));

await browser.close();
