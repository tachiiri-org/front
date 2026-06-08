/**
 * CDP接続中のブラウザでスクリーンショットを撮る
 * 事前に start-session.ts でブラウザを起動しておくこと
 *
 * Usage: npx tsx e2e/screenshot.ts [url] [output-path]
 *   url: 省略時は現在のページをそのまま撮影
 *   output-path: 省略時は /tmp/screenshot.png
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const CDP_PORT = 9222;
const url = process.argv[2];
const outPath = process.argv[3] ?? '/tmp/screenshot.png';

async function isCDPRunning(): Promise<boolean> {
  return fetch(`http://localhost:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1000) })
    .then(() => true)
    .catch(() => false);
}

if (!await isCDPRunning()) {
  console.error('[screenshot] ブラウザが起動していません。先に start-session.ts を実行してください');
  process.exit(1);
}

const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

if (url) {
  const target = url.startsWith('http') ? url : `${BASE_URL}/${url.replace(/^\//, '')}`;
  await page.goto(target, { waitUntil: 'networkidle' });
}

await page.screenshot({ path: outPath, fullPage: true });
await browser.close();
console.log('saved:', outPath, '| url:', page.url());
