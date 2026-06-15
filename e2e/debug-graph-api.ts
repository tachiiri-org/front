import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const TARGET = 'https://front-production.tachiiri.workers.dev';

async function main() {
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const contexts = browser.contexts();
  const ctx = contexts[0] ?? await browser.newContext();
  const page = await ctx.newPage();

  // Navigate to production graph editor first so cookies are set
  await page.goto(`${TARGET}/graph-editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const result = await page.evaluate(async () => {
    const list = await fetch('/api/graph/', { credentials: 'include' });
    const listText = await list.text();
    const post = await fetch('/api/graph/', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'test-debug-id', name: 'Debug Test' }),
    });
    const postText = await post.text();
    const noSlash = await fetch('/api/graph', { credentials: 'include' });
    const noSlashText = await noSlash.text();
    return {
      list: { status: list.status, body: listText.slice(0, 400) },
      post: { status: post.status, body: postText.slice(0, 400) },
      noSlash: { status: noSlash.status, body: noSlashText.slice(0, 400) },
    };
  });

  console.log(`GET /api/graph/ → ${result.list.status}`);
  console.log('body:', result.list.body);
  console.log(`POST /api/graph/ → ${result.post.status}`);
  console.log('body:', result.post.body);
  console.log(`GET /api/graph (no slash) → ${result.noSlash.status}`);
  console.log('body:', result.noSlash.body);

  await page.close();
}

main().catch(console.error);
