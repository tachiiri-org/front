import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

const consoleLogs: string[] = [];
const consoleErrors: string[] = [];
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
  else consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', err => consoleErrors.push(`PAGEERROR: ${err.message}`));
page.on('requestfailed', req => consoleErrors.push(`REQFAIL: ${req.method()} ${req.url()} — ${req.failure()?.errorText}`));
page.on('response', resp => {
  if (!resp.ok() && resp.url().includes('tachiiri')) {
    resp.text().then(body => {
      consoleErrors.push(`HTTP ${resp.status()} ${resp.url()} — ${body.slice(0, 300)}`);
    }).catch(() => {});
  }
});

await page.goto(`${BASE_URL}/graph-editor`, { waitUntil: 'networkidle' });
await new Promise<void>(r => setTimeout(r, 2000));

// Click first word
const firstWord = page.locator('[data-column-index="1"][data-nav-input="node"]').first();
if (await firstWord.count() > 0) {
  await firstWord.click();
  await new Promise<void>(r => setTimeout(r, 1000));

  // Click first text
  const firstText = page.locator('[data-column-index="2"][data-nav-input="node"]').first();
  if (await firstText.count() > 0) {
    await firstText.click();
    await new Promise<void>(r => setTimeout(r, 1500));

    // Type in draft input and press Enter
    const draftTA = page.locator('[data-frame-id="wg-doc-col-3"] textarea').first();
    if (await draftTA.count() > 0) {
      await draftTA.click();
      await draftTA.fill('コンソールエラー確認テスト');
      await new Promise<void>(r => setTimeout(r, 500));
      await draftTA.press('Enter');
      await new Promise<void>(r => setTimeout(r, 3000));
    } else {
      consoleErrors.push('No textarea found in doc col after selecting text');
    }
  } else {
    consoleErrors.push('No texts found in col2');
  }
} else {
  consoleErrors.push('No words found in col1');
}

await page.screenshot({ path: '/tmp/console-check.png' });

console.log('\n=== ERRORS ===');
consoleErrors.forEach(e => console.log(e));
console.log('\n=== LOGS (last 20) ===');
consoleLogs.slice(-20).forEach(l => console.log(l));

await browser.close();
