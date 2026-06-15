import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

await page.goto(`${BASE_URL}/graph-editor`);
await page.waitForLoadState('networkidle');
await new Promise<void>(r => setTimeout(r, 1000));

// Click on the first word
const firstWord = page.locator('[data-column-index="1"][data-nav-input="node"]').first();
await firstWord.click();
await new Promise<void>(r => setTimeout(r, 500));

// Click on the first text in col2
const firstText = page.locator('[data-column-index="2"][data-nav-input="node"]').first();
const textCount = await page.locator('[data-column-index="2"][data-nav-input="node"]').count();
console.log('text count in col2:', textCount);

if (textCount > 0) {
  await firstText.click();
  await new Promise<void>(r => setTimeout(r, 500));
  await page.screenshot({ path: '/tmp/after-text-click.png' });
  
  // Check if draft input in col3 appears
  const docDraftCount = await page.locator('[data-column-index="3"][data-nav-input="draft"]').count();
  console.log('doc draft input count:', docDraftCount);
  
  if (docDraftCount > 0) {
    const docDraft = page.locator('[data-column-index="3"][data-nav-input="draft"]').first();
    await docDraft.click();
    await docDraft.fill('test document entry');
    await page.screenshot({ path: '/tmp/before-enter.png' });
    
    const docRequestPromise = page.waitForRequest(
      (req: { url: () => string; method: () => string }) => req.url().includes('/document') && req.method() === 'POST',
      { timeout: 5000 }
    ).catch(() => null);
    
    await docDraft.press('Enter');
    await new Promise<void>(r => setTimeout(r, 2000));
    
    const req = await docRequestPromise;
    console.log('POST /document request:', req ? (req as { url: () => string }).url() : 'NOT MADE');
    if (req) {
      const resp = await (req as { response: () => Promise<{ status: () => number; text: () => Promise<string> } | null> }).response();
      console.log('response status:', resp?.status());
      const body = await resp?.text();
      console.log('response body:', body?.slice(0, 300));
    }
    
    await page.screenshot({ path: '/tmp/after-enter.png' });
  } else {
    console.log('No doc draft input found - doc-col may not be showing draft input');
    await page.screenshot({ path: '/tmp/no-draft.png' });
  }
}

await browser.close();
