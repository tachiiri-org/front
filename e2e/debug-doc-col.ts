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
const textCount = await page.locator('[data-column-index="2"][data-nav-input="node"]').count();
console.log('text count in col2:', textCount);

if (textCount > 0) {
  const firstText = page.locator('[data-column-index="2"][data-nav-input="node"]').first();
  await firstText.click();
  await new Promise<void>(r => setTimeout(r, 1000));
  
  // The doc-col draftInput has no data-nav-input attr — select by frame + textarea
  const docFrame = page.locator('[data-frame-id="wg-doc-col-3"]');
  const docTextareas = docFrame.locator('textarea');
  const textareaCount = await docTextareas.count();
  console.log('textareas in doc col:', textareaCount);
  
  if (textareaCount > 0) {
    // first textarea is the draft input
    const draftTA = docTextareas.first();
    await draftTA.click();
    await draftTA.fill('test document entry');
    
    // Intercept network requests
    const allRequests: string[] = [];
    page.on('request', req => {
      if (req.url().includes('/document')) allRequests.push(`${req.method()} ${req.url()}`);
    });
    page.on('response', resp => {
      if (resp.url().includes('/document')) {
        resp.text().then(body => {
          console.log(`Response: ${resp.status()} ${resp.url()} — ${body.slice(0, 200)}`);
        }).catch(() => {});
      }
    });
    
    await draftTA.press('Enter');
    await new Promise<void>(r => setTimeout(r, 3000));
    
    console.log('requests made:', allRequests);
    await page.screenshot({ path: '/tmp/after-enter.png' });
  }
}

await browser.close();
