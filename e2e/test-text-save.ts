import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const TARGET = 'https://front-production.tachiiri.workers.dev';

const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const contexts = browser.contexts();
const ctx = contexts[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

await page.goto(`${TARGET}/graph-editor`);
await page.waitForTimeout(3000);

// Inject state inspector into draft input Enter handler
await page.evaluate(() => {
  // Find the text col draft input and wrap its keydown to inspect state
  const draftInput = document.querySelector('textarea[data-nav-input="draft"][data-column-index="2"]') as HTMLTextAreaElement | null;
  if (!draftInput) {
    console.log('No col2 draft input found yet');
    return;
  }
  console.log('Found col2 draft input');
});

// Click on the first word
const wordInputs = await page.locator('textarea[data-column-index="1"]').all();
console.log('Word count:', wordInputs.length);
if (wordInputs.length === 0) {
  console.log('No words found, exiting');
  process.exit(0);
}

// Click first word
await wordInputs[0].click();
await page.waitForTimeout(800);

// Inject debug hook before pressing Enter
await page.evaluate(() => {
  const draftInput = document.querySelector('textarea[data-nav-input="draft"][data-column-index="2"]') as HTMLTextAreaElement | null;
  if (draftInput) {
    draftInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        // Try to find the shared state
        const graphId = document.querySelector('[data-graph-id]')?.getAttribute('data-graph-id') ?? 'unknown';
        console.log('GRAPH_ID:', graphId);
        // Try to find path from internal state - check all frame containers
        const frames = document.querySelectorAll('[data-frame-id]');
        frames.forEach(f => {
          console.log('FRAME:', (f as HTMLElement).dataset.frameId, 'graphId:', (f as HTMLElement).dataset.graphId);
        });
      }
    }, { capture: true });
    console.log('Debug hook injected');
  } else {
    console.log('Still no col2 draft input');
  }
});

// Check which word was clicked and what the path should be
const firstWordText = await wordInputs[0].inputValue();
console.log('Clicked word:', firstWordText);

// Type text in col2 draft
const textDraft = page.locator('textarea[data-nav-input="draft"][data-column-index="2"]').first();
const draftCount = await textDraft.count();
console.log('Col2 draft count:', draftCount);

if (draftCount > 0) {
  await textDraft.click();
  await textDraft.fill('テストテキスト2');

  // Check state before pressing Enter via page.evaluate
  const stateInfo = await page.evaluate(() => {
    const draftInput = document.querySelector('textarea[data-nav-input="draft"][data-column-index="2"]') as HTMLTextAreaElement | null;
    const wordInputs = Array.from(document.querySelectorAll('textarea[data-column-index="1"]')) as HTMLTextAreaElement[];
    return {
      draftValue: draftInput?.value,
      wordCount: wordInputs.length,
      focusedElement: document.activeElement?.tagName + ' ' + (document.activeElement as HTMLElement)?.dataset?.navInput + ' ' + (document.activeElement as HTMLElement)?.dataset?.columnIndex,
    };
  });
  console.log('State before Enter:', JSON.stringify(stateInfo));

  // Intercept the PUT request to see wordIds
  const putPromise = page.waitForRequest(req => req.method() === 'PUT' && req.url().includes('/api/graph/'));
  await textDraft.press('Enter');

  try {
    const putReq = await putPromise.catch(() => null);
    if (putReq) {
      const body = putReq.postData() ?? '';
      const parsed = JSON.parse(body) as { texts: Array<{ id: string; wordIds: string[]; en?: string }> };
      const newText = parsed.texts.find(t => t.en === 'テストテキスト2');
      console.log('New text in PUT body:', JSON.stringify(newText));
    }
  } catch (e) {
    console.log('No PUT request captured');
  }
}

await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/text-debug.png' });
console.log('Done');
