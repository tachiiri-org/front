/**
 * CDP接続ブラウザでDB Applyページを表示してスクリーンショット
 * Usage: npx tsx e2e/view-db-apply.ts
 */
import { chromium } from '@playwright/test';
import { BASE_URL, TACHIIRI_ORG_ID } from './session.ts';

const CDP_PORT = 9222;

async function isCDPRunning(): Promise<boolean> {
  return fetch(`http://localhost:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1000) })
    .then(() => true)
    .catch(() => false);
}

if (!await isCDPRunning()) {
  console.error('[view-db-apply] ブラウザが起動していません。先に start-session.ts を実行してください');
  process.exit(1);
}

const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

await page.goto(`${BASE_URL}/api/auth/select-org?org_id=${TACHIIRI_ORG_ID}`, { waitUntil: 'networkidle' });
await page.goto(`${BASE_URL}/DB%20Apply`, { waitUntil: 'networkidle' });

await page.screenshot({ path: '/tmp/db-apply.png', fullPage: true });
console.log('url:', page.url());
await browser.close();
