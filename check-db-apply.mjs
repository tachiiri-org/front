import { chromium } from 'playwright';

const PRODUCTION_URL = 'https://front-production.tachiiri.workers.dev';
const SCREEN_ID = '586cf65a-65d9-4e58-8889-0b628ac7a94b';
const SCREEN_URL = `${PRODUCTION_URL}/${SCREEN_ID}`;
const GOOGLE_EMAIL = 'admin@tachiiri.com';
const GOOGLE_PASSWORD = '@dmin1239';

async function hasCookieViaJS(page, name) {
  return page.evaluate(n => document.cookie.includes(n), name);
}

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  const apiErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.log(`[CONSOLE ERROR] ${msg.text()}`);
    }
  });
  page.on('response', resp => {
    const url = resp.url();
    const status = resp.status();
    if (url.includes('/api/admin/db-apply') && status >= 400) {
      apiErrors.push({ status, url });
      console.log(`[API ${status}] ${url}`);
    }
  });

  // ── Step 1: Google login ──────────────────────────────────────
  console.log('\n=== Step 1: Google ログイン ===');
  await page.goto(`${PRODUCTION_URL}/oauth/google/start`, { waitUntil: 'domcontentloaded' });

  if (page.url().includes('accounts.google.com')) {
    // Fill email
    await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
    await page.fill('input[type="email"]', GOOGLE_EMAIL);
    await page.keyboard.press('Enter');
    // Fill password
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
    await page.waitForTimeout(1200);
    await page.fill('input[type="password"]', GOOGLE_PASSWORD);
    await page.keyboard.press('Enter');

    // Handle challenge - wait up to 5 minutes for user to approve
    console.log('\n⚠  Google が追加認証（スマホ承認・2FA）を求めている可能性があります。');
    console.log('   ブラウザの画面を確認し、スマホ等で「はい」を承認してください。');
    console.log('   承認後、自動で続行します（最大5分待機）...\n');

    await page.waitForURL(`${PRODUCTION_URL}/**`, { timeout: 300_000 });
    console.log(`✅ ログイン完了: ${page.url()}`);
  } else {
    console.log(`(Google OAuth スキップ: ${page.url()})`);
  }

  // ── Step 2: Select org ────────────────────────────────────────
  console.log('\n=== Step 2: 組織選択 ===');

  // Get list of available orgs from nav
  if (!page.url().startsWith(PRODUCTION_URL)) {
    await page.goto(`${PRODUCTION_URL}/org-select`, { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(2000);

  const orgOptions = await page.evaluate(() => {
    const sel = document.querySelector('select');
    return sel ? Array.from(sel.options).filter(o => o.value).map(o => ({ value: o.value, text: o.textContent?.trim() })) : [];
  });
  console.log('利用可能な組織:', orgOptions.map(o => o.value));

  // Prefer migration-admin org if available
  const targetOrg = orgOptions.find(o => o.value === 'migration-admin') ?? orgOptions[0];
  if (targetOrg) {
    console.log(`直接 select-org へ遷移: org_id=${targetOrg.value}`);
    await page.goto(`${PRODUCTION_URL}/api/auth/select-org?org_id=${encodeURIComponent(targetOrg.value)}`, { waitUntil: 'networkidle' });
    console.log(`URL: ${page.url()}`);
  }

  // Verify org cookie
  let orgSet = await hasCookieViaJS(page, 'identity_org_id');
  console.log(`identity_org_id set: ${orgSet}`);

  if (!orgSet) {
    console.log('\n⚠ 組織クッキーが設定されていません。');
    console.log('ブラウザで手動操作してください（ヘッダープルダウンで組織選択 → 画面選択）。');
    console.log('migration-admin 画面に到達したら Enter を押してください...');
    // Wait for user to navigate to the screen manually
    await page.waitForURL(`**/${SCREEN_ID}**`, { timeout: 300_000 });
    console.log('✅ migration-admin 画面を検出しました。');
  }

  // ── Step 3: GitHub Connect ────────────────────────────────────
  console.log('\n=== Step 3: GitHub Connect ===');
  await page.goto(`${PRODUCTION_URL}/oauth/github/connect/start`, { waitUntil: 'domcontentloaded' });
  console.log(`URL: ${page.url()}`);

  if (page.url().includes('github.com')) {
    console.log('\n⚠ GitHub 認証が必要です。ブラウザで操作してください（最大5分）...');
    await page.waitForTimeout(2000);
    // Try to click authorize if already logged in
    const authBtn = await page.$('button[name="authorize"]');
    if (authBtn) {
      await authBtn.click();
      console.log('Authorize クリック。');
    }
    await page.waitForURL(`${PRODUCTION_URL}/**`, { timeout: 300_000 });
    console.log(`✅ GitHub Connect 完了: ${page.url()}`);
  } else {
    console.log(`(接続済み or スキップ: ${page.url()})`);
  }

  // ── Step 4: Migration admin screen ───────────────────────────
  console.log(`\n=== Step 4: Migration Admin 画面 ===`);
  consoleErrors.length = 0;
  apiErrors.length = 0;

  await page.goto(SCREEN_URL, { waitUntil: 'domcontentloaded' });

  const layoutStatus = await Promise.race([
    page.waitForResponse(r => r.url().includes('/api/layouts/') && r.status() === 200, { timeout: 15_000 }).then(() => 200),
    page.waitForResponse(r => r.url().includes('/api/layouts/') && r.status() !== 200, { timeout: 15_000 }).then(r => r.status()),
  ]).catch(() => 'timeout');

  console.log(`[layout] status=${layoutStatus}`);
  if (layoutStatus !== 200) {
    console.log('⚠ レイアウト取得失敗 — ブラウザでの手動確認をお願いします。');
    console.log('120秒後に閉じます。Ctrl+C で即時終了。');
    await page.waitForTimeout(120_000).catch(() => {});
    await browser.close();
    return;
  }

  console.log('db-apply/status の応答を待機中...');
  const dbApplyResp = await page.waitForResponse(
    r => r.url().includes('/api/admin/db-apply/status'),
    { timeout: 20_000 },
  ).catch(() => null);

  if (dbApplyResp) {
    console.log(`[db-apply/status] status=${dbApplyResp.status()}`);
    if (dbApplyResp.ok()) {
      const body = await dbApplyResp.json().catch(() => null);
      console.log('[db-apply/status] body:', JSON.stringify(body, null, 2));
    } else {
      const text = await dbApplyResp.text().catch(() => '');
      console.log(`[db-apply/status] error body: ${text}`);
    }
  } else {
    console.log('(db-apply/status 呼び出しなし — GitHub Connect が必要かもしれません)');
  }

  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 3000));
  console.log('\n--- ページ本文 ---');
  console.log(bodyText || '(空)');

  // ── Step 5: Results ───────────────────────────────────────────
  console.log('\n========== RESULT ==========');
  const errors502 = apiErrors.filter(e => e.status === 502);
  const errors5xx = apiErrors.filter(e => e.status >= 500);
  const consoleErrs502 = consoleErrors.filter(e => e.includes('502'));

  if (errors502.length === 0 && consoleErrs502.length === 0) {
    console.log('✅ 502 エラーなし');
  } else {
    console.log('❌ 502 エラーあり:');
    for (const e of errors502) console.log(`  API ${e.status} ${e.url}`);
    for (const e of consoleErrs502) console.log(`  Console: ${e}`);
  }

  if (errors5xx.length === 0) {
    console.log('✅ 5xx エラーなし');
  } else {
    for (const e of errors5xx) console.log(`  ⚠ ${e.status} ${e.url}`);
  }

  if (errors502.length === 0 && consoleErrs502.length === 0 && errors5xx.length === 0) {
    console.log('\n🎉 db-apply エンドポイントは正常に動作しています！');
  }
  console.log('============================\n');

  console.log('ブラウザを確認してください。120秒後に閉じます。Ctrl+C で即時終了。');
  await page.waitForTimeout(120_000).catch(() => {});
  await browser.close();
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
