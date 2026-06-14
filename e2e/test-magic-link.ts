/**
 * Magic link フローのデバッグスクリプト
 * 1. ログインページでメール送信 → 送信確認
 * 2. D1 から最新トークンを取得
 * 3. /auth/magic?token=... にアクセスして結果を確認
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const BASE_URL = process.env.BASE_URL ?? 'https://front-dev.tachiiri.workers.dev';
const TEST_EMAIL = process.env.MAGIC_TEST_EMAIL ?? 'shu-ito@voltage.co.jp';

async function connectBrowser() {
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const contexts = browser.contexts();
  if (contexts.length === 0) throw new Error('No browser context found. Run start-session.ts first.');
  return { browser, page: await contexts[0].newPage() };
}

async function run() {
  // Step 1: ログインページでメール送信
  console.log(`\n=== Step 1: メール送信 (${TEST_EMAIL}) ===`);
  const { browser, page } = await connectBrowser();

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/magic-1-login.png' });
  console.log('saved: /tmp/magic-1-login.png');

  const emailInput = page.locator('#l-email');
  const sendBtn = page.locator('#l-btn');

  if (!(await emailInput.isVisible())) {
    console.error('ERROR: #l-email が見えない');
    await browser.close();
    return;
  }

  await emailInput.fill(TEST_EMAIL);
  await sendBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/magic-2-after-send.png' });
  console.log('saved: /tmp/magic-2-after-send.png');

  const statusText = await page.locator('#l-status').textContent();
  console.log('Status:', statusText);

  // Step 2: D1 からトークンを直接取得 (API経由)
  console.log('\n=== Step 2: D1 からトークン取得 ===');
  const tokenRes = await page.request.get(`${BASE_URL}/api/auth/magic-link-debug`).catch(() => null);
  // 直接APIはないので、D1 MCPツール経由で取得する旨をログ出力
  console.log('NOTE: D1 MCPツールでトークンを取得してください');
  console.log('wrangler d1 execute コマンド例:');
  console.log(`  SELECT token, email, used, expires_at FROM t_magic_link WHERE email='${TEST_EMAIL}' ORDER BY expires_at DESC LIMIT 1`);

  await browser.close();
}

run().catch(console.error);
