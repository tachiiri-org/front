import { chromium } from '@playwright/test';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor', { waitUntil: 'networkidle' });

// Get all texts
const texts = await page.evaluate(async () => {
  const r = await fetch('/api/graph/word-graph-1/texts');
  return { status: r.status, body: await r.text() };
});
const textsData = JSON.parse(texts.body);
console.log('GET /texts:', texts.status, 'count:', textsData.texts?.length);
const textId = textsData.texts?.find((t: {id: string}) => t.id)?.id;
console.log('textId:', textId);

if (!textId) {
  // Create a test text first via the word-graph-1 graph
  const addText = await page.evaluate(async () => {
    const r = await fetch('/api/graph/word-graph-1/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ja: 'テスト文', words: [] }),
    });
    return { status: r.status, body: await r.text() };
  });
  console.log('POST /text (create test text):', addText.status, addText.body);
  const created = JSON.parse(addText.body);
  const tid = created.id;
  
  // Now test documents with this text
  const getDocs = await page.evaluate(async (id: string) => {
    const r = await fetch(`/api/graph/word-graph-1/documents?text_id=${id}`);
    return { status: r.status, body: await r.text() };
  }, tid);
  console.log('GET /documents:', getDocs.status, getDocs.body.slice(0, 200));
  
  const postDoc = await page.evaluate(async (id: string) => {
    const r = await fetch('/api/graph/word-graph-1/document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ja: 'テストドキュメント確認', textIds: [id] }),
    });
    return { status: r.status, body: await r.text() };
  }, tid);
  console.log('POST /document:', postDoc.status, postDoc.body);
  
  await browser.close();
  process.exit(0);
}

const getDocs = await page.evaluate(async (tid: string) => {
  const r = await fetch(`/api/graph/word-graph-1/documents?text_id=${tid}`);
  return { status: r.status, body: await r.text() };
}, textId);
console.log('GET /documents:', getDocs.status, getDocs.body.slice(0, 200));

const postDoc = await page.evaluate(async (tid: string) => {
  const r = await fetch('/api/graph/word-graph-1/document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ja: 'テストドキュメント確認', textIds: [tid] }),
  });
  return { status: r.status, body: await r.text() };
}, textId);
console.log('POST /document:', postDoc.status, postDoc.body);

if (postDoc.status === 201) {
  const created = JSON.parse(postDoc.body);
  const del = await page.evaluate(async (docId: string) => {
    const r = await fetch(`/api/graph/word-graph-1/document/${docId}`, { method: 'DELETE' });
    return r.status;
  }, created.id);
  console.log('DELETE:', del);
}
await browser.close();
