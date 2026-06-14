/**
 * /auth/magic?token=... にアクセスしてリダイレクト先を確認
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const BASE_URL = 'https://front-dev.tachiiri.workers.dev';
const token = process.argv[2];
if (!token) { console.error('Usage: npx tsx e2e/test-magic-verify.ts <token>'); process.exit(1); }

async function run() {
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  // /auth/magic にアクセスしてすべてのリダイレクトを追う
  const responses: { url: string; status: number }[] = [];
  page.on('response', r => responses.push({ url: r.url(), status: r.status() }));

  const targetUrl = `${BASE_URL}/auth/magic?token=${token}`;
  console.log('Navigating to:', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'networkidle' });

  console.log('\nResponse chain:');
  for (const r of responses) {
    console.log(`  ${r.status} ${r.url}`);
  }
  console.log('\nFinal URL:', page.url());

  await page.screenshot({ path: '/tmp/magic-verify.png' });
  console.log('saved: /tmp/magic-verify.png');

  await page.close();
  await browser.close();
}

run().catch(console.error);
