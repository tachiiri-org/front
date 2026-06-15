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

// Click on an actual WORD ITEM (data-nav-input="node"), not the draft
const wordItems = await page.locator('textarea[data-nav-input="node"][data-column-index="1"]').all();
console.log('Word item count:', wordItems.length);
if (wordItems.length === 0) {
  console.log('No word items found, exiting');
  process.exit(0);
}

// Click first word item to set state.path[1]
await wordItems[0].click();
await page.waitForTimeout(800);

const firstWordText = await wordItems[0].inputValue();
console.log('Clicked word item:', firstWordText);

// Check state.path after clicking word item
const pathAfterWordClick = await page.evaluate(() => {
  // Try to find state via the store (can't directly, but check active element)
  const active = document.activeElement as HTMLElement | null;
  return {
    activeTag: active?.tagName,
    activeNavInput: active?.dataset?.navInput,
    activeColIndex: active?.dataset?.columnIndex,
    activeNodeId: active?.dataset?.nodeId,
  };
});
console.log('Active after word click:', JSON.stringify(pathAfterWordClick));

// Check if text col draft (colIndex=2) is visible
const textDraft = page.locator('textarea[data-nav-input="draft"][data-column-index="2"]').first();
const draftCount = await textDraft.count();
console.log('Text draft count:', draftCount);

if (draftCount === 0) {
  await page.screenshot({ path: '/tmp/text-debug2-nodraft.png' });
  console.log('No text draft found - screenshot saved');
  process.exit(0);
}

// Click text draft and fill
await textDraft.click();
await textDraft.fill('テストテキストNodeClick');

// Check state before Enter
const stateBefore = await page.evaluate(() => {
  const draftInput = document.querySelector('textarea[data-nav-input="draft"][data-column-index="2"]') as HTMLTextAreaElement | null;
  const wordNodes = Array.from(document.querySelectorAll('textarea[data-nav-input="node"][data-column-index="1"]')) as HTMLTextAreaElement[];
  return {
    draftValue: draftInput?.value,
    wordNodeCount: wordNodes.length,
    active: {
      navInput: (document.activeElement as HTMLElement)?.dataset?.navInput,
      colIndex: (document.activeElement as HTMLElement)?.dataset?.columnIndex,
    },
  };
});
console.log('State before Enter:', JSON.stringify(stateBefore));

// Intercept PUT to see what wordIds are sent
const putPromise = page.waitForRequest(req => req.method() === 'PUT' && req.url().includes('/api/graph/'), { timeout: 5000 });

await textDraft.press('Enter');
await page.waitForTimeout(1000);

try {
  const putReq = await putPromise.catch(() => null);
  if (putReq) {
    const body = putReq.postData() ?? '';
    const parsed = JSON.parse(body) as { texts: Array<{ id: string; wordIds: string[]; en?: string; ja?: string }> };
    const newText = parsed.texts.find(t => t.en === 'テストテキストNodeClick' || t.ja === 'テストテキストNodeClick');
    console.log('New text in PUT body:', JSON.stringify(newText));
    console.log('Total texts in PUT:', parsed.texts.length);
  } else {
    console.log('No PUT request captured');
  }
} catch (e) {
  console.log('Error:', e);
}

// Check what text items appear in col2 after the Enter
const textItemsAfter = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('textarea[data-nav-input="node"][data-column-index="2"]')) as HTMLTextAreaElement[];
  return items.map(i => ({ value: i.value, nodeId: i.dataset.nodeId }));
});
console.log('Text items in col2 after Enter:', JSON.stringify(textItemsAfter));

await page.screenshot({ path: '/tmp/text-debug2.png' });
console.log('Screenshot saved to /tmp/text-debug2.png');
