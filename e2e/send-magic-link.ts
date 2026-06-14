/**
 * devでメールを送信してステータスを確認する
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const BASE_URL = 'https://front-dev.tachiiri.workers.dev';
const TEST_EMAIL = process.env.MAGIC_TEST_EMAIL ?? 'shu-ito@voltage.co.jp';

async function run() {
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });

  const emailInput = page.locator('#l-email');
  await emailInput.fill(TEST_EMAIL);

  // フォーム送信をインターセプトしてレスポンスを確認
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/auth/magic-link')),
    page.locator('#l-btn').click(),
  ]);

  console.log('POST /api/auth/magic-link status:', response.status());
  const body = await response.text();
  console.log('response body:', body);

  await page.waitForTimeout(1000);
  const status = await page.locator('#l-status').textContent();
  console.log('UI status:', status);

  await page.screenshot({ path: '/tmp/magic-send.png' });
  await page.close();
  await browser.close();
}

run().catch(console.error);
