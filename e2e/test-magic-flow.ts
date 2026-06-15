/**
 * Magic link フロー E2E テスト
 * 1. org_create: メール + 組織名 → magic link → グループ作成 → アプリへ
 * 2. org_login: 組織専用URL → メール → magic link → ログイン
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';

const CDP_PORT = 9222;
const BASE_URL = 'https://front-dev.tachiiri.workers.dev';
const TEST_EMAIL = process.env.MAGIC_TEST_EMAIL ?? 'shu-ito@voltage.co.jp';

async function connectPage() {
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const ctx = browser.contexts()[0];
  return { browser, page: await ctx.newPage() };
}

function getLatestToken(email: string): string {
  const out = execSync(
    `npx wrangler d1 execute identity-dev --env dev --remote --command "SELECT token FROM t_magic_link WHERE email='${email.toLowerCase()}' AND used=0 ORDER BY expires_at DESC LIMIT 1" 2>/dev/null`,
    { cwd: '/home/tachiiri/project/backend', encoding: 'utf-8' },
  );
  const match = out.match(/"token":\s*"([a-f0-9]{64})"/);
  if (!match) throw new Error('Token not found in D1');
  return match[1];
}

async function testOrgCreate() {
  console.log('\n=== TEST: org_create フロー ===');
  const { browser, page } = await connectPage();
  const groupName = `テスト組織-${Date.now()}`;

  await page.goto(`${BASE_URL}/login?next=org_create`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/flow-1-org-create-login.png' });
  console.log('1. ログインページ (org_create mode)');

  const groupInput = page.locator('#l-group-name');
  const emailInput = page.locator('#l-email');
  const sendBtn = page.locator('#l-btn');

  if (!(await groupInput.isVisible())) {
    console.error('ERROR: #l-group-name が表示されていない');
    await page.close(); await browser.close(); return false;
  }

  await groupInput.fill(groupName);
  await emailInput.fill(TEST_EMAIL);

  const [resp] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/auth/magic-link')),
    sendBtn.click(),
  ]);
  console.log('2. magic link 送信:', resp.status(), await resp.text());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/flow-2-sent.png' });

  // D1 からトークン取得
  console.log('3. D1 からトークン取得...');
  const token = getLatestToken(TEST_EMAIL);
  console.log('   token:', token.slice(0, 16) + '...');

  // magic link を開く
  const responses: { url: string; status: number }[] = [];
  page.on('response', r => responses.push({ url: r.url(), status: r.status() }));
  await page.goto(`${BASE_URL}/auth/magic?token=${token}`, { waitUntil: 'networkidle' });
  console.log('4. magic link クリック後:');
  for (const r of responses) console.log(`   ${r.status} ${r.url.replace(BASE_URL, '')}`);
  console.log('   Final URL:', page.url().replace(BASE_URL, ''));
  await page.screenshot({ path: '/tmp/flow-3-after-magic.png' });

  const finalUrl = page.url();
  const success = !finalUrl.includes('error=') && !finalUrl.includes('/login');
  console.log(success ? '✅ 成功' : '❌ 失敗: ' + finalUrl);

  await page.close(); await browser.close();
  return success;
}

testOrgCreate().catch(console.error);
