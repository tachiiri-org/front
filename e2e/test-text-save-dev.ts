import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const TARGET = 'https://front-dev.tachiiri.workers.dev';

const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const contexts = browser.contexts();
const ctx = contexts[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

await page.goto(`${TARGET}/graph-editor`);
await page.waitForTimeout(3000);

// Check: text draft should be disabled initially (no word selected)
const draftInitial = await page.evaluate(() => {
  const d = document.querySelector('textarea[data-nav-input="draft"][data-column-index="2"]') as HTMLTextAreaElement | null;
  return { disabled: d?.disabled, placeholder: d?.placeholder };
});
console.log('Draft before word click (should be disabled):', JSON.stringify(draftInitial));

// Click an actual word item
const wordItems = await page.locator('textarea[data-nav-input="node"][data-column-index="1"]').all();
if (wordItems.length === 0) { console.log('No word items'); process.exit(0); }
await wordItems[0].click();
await page.waitForTimeout(500);

// Check: text draft should be enabled now
const draftAfterWord = await page.evaluate(() => {
  const d = document.querySelector('textarea[data-nav-input="draft"][data-column-index="2"]') as HTMLTextAreaElement | null;
  return { disabled: d?.disabled, placeholder: d?.placeholder };
});
console.log('Draft after word click (should be enabled):', JSON.stringify(draftAfterWord));

// Try to add a text
const textDraft = page.locator('textarea[data-nav-input="draft"][data-column-index="2"]').first();
await textDraft.click();
await textDraft.fill('テスト修正確認');

const putPromise = page.waitForRequest(req => req.method() === 'PUT' && req.url().includes('/api/graph/'), { timeout: 5000 });
await textDraft.press('Enter');
await page.waitForTimeout(800);

try {
  const putReq = await putPromise.catch(() => null);
  if (putReq) {
    const body = putReq.postData() ?? '';
    const parsed = JSON.parse(body) as { texts: Array<{ id: string; wordIds: string[]; en?: string; ja?: string }> };
    const newText = parsed.texts.find(t => t.en === 'テスト修正確認' || t.ja === 'テスト修正確認');
    console.log('New text in PUT (should have wordIds):', JSON.stringify(newText));
  } else {
    console.log('No PUT captured');
  }
} catch (e) {
  console.log('Error:', e);
}

await page.screenshot({ path: '/tmp/text-dev-fix.png' });
console.log('Screenshot: /tmp/text-dev-fix.png');
