import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL ?? 'https://front-stage.tachiiri.workers.dev';
const TACHIIRI_ORG_ID = '9c95aa5e-5943-4dd0-9579-ed3725821979';

// 環境ごとに別ファイルで管理
const ENV_SLUG = BASE_URL.replace(/https?:\/\//, '').replace(/[^a-z0-9]/g, '-');
export const AUTH_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  `.auth/${ENV_SLUG}.json`,
);

type AuthStatus = {
  google: { authenticated: boolean };
  githubConnect: { authenticated: boolean; scopes: string[] | null };
};

async function getAuthStatus(): Promise<AuthStatus | null> {
  if (!existsSync(AUTH_FILE)) return null;

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: AUTH_FILE });
  const page = await context.newPage();
  try {
    const res = await page.goto(`${BASE_URL}/api/auth/status`);
    if (!res?.ok()) return null;
    return (await res.json()) as AuthStatus;
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

// GitHub の OAuth フロー完了を待つ共通処理
async function waitForGitHubOAuth(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>>,
  username: string | undefined,
  password: string | undefined,
  label: string,
) {
  if (username && password) {
    // GitHub の "Sign in with Google" ボタンを探してクリック
    const googleBtn = page.locator('a:has-text("Sign in with Google"), button:has-text("Sign in with Google")');
    if (await googleBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await googleBtn.click();

      // Google 認証画面でメール・パスワードを入力
      await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
      await page.fill('input[type="email"]', username);
      await page.click('#identifierNext, button:has-text("次へ"), button:has-text("Next")');
      await page.waitForSelector('input[type="password"]', { timeout: 15_000 });
      await page.fill('input[type="password"]', password);
      await page.click('#passwordNext, button:has-text("次へ"), button:has-text("Next")');
    }

    // 送信後8秒で戻らなければデバイス認証が必要
    const redirected = await page
      .waitForURL((url) => !url.toString().includes('github.com') && !url.toString().includes('accounts.google.com'), { timeout: 8_000 })
      .then(() => true)
      .catch(() => false);

    if (!redirected) {
      console.log('');
      console.log('==================================================');
      console.log(`[auth:${label}] デバイス認証が必要です。`);
      console.log(`[auth:${label}] ブラウザウィンドウで認証を完了してください。`);
      console.log('==================================================');
      console.log('');
    }
  } else {
    console.log(`[auth:${label}] GITHUB_USERNAME/GITHUB_PASSWORD not set — please log in manually.`);
  }

  // GitHub / Google の OAuth が完了してアプリに戻るまで最大5分待機
  await page.waitForURL(
    (url) => !url.toString().includes('github.com') && !url.toString().includes('accounts.google.com'),
    { timeout: 300_000 },
  );
}

async function globalSetup() {
  await mkdir(path.dirname(AUTH_FILE), { recursive: true });

  const status = await getAuthStatus();

  // --- Google ログイン ---
  if (status?.google.authenticated) {
    console.log('[auth:google] Existing session is valid, reusing.');
  } else {
    console.log('[auth:google] Session expired or missing. Opening browser for Google login...');

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    const loginSelect = page.locator('select').filter({ hasText: 'Google' });
    if (await loginSelect.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await loginSelect.selectOption({ label: 'Google' });
    } else {
      await page.goto(`${BASE_URL}/oauth/google/start`);
    }

    const email = process.env.GOOGLE_EMAIL;
    const pass = process.env.GOOGLE_PASSWORD;

    if (email && pass) {
      await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
      await page.fill('input[type="email"]', email);
      await page.click('#identifierNext, button:has-text("次へ"), button:has-text("Next")');
      await page.waitForSelector('input[type="password"]', { timeout: 15_000 });
      await page.fill('input[type="password"]', pass);
      await page.click('#passwordNext, button:has-text("次へ"), button:has-text("Next")');

      const redirected = await page
        .waitForURL((url) => !url.toString().includes('accounts.google.com'), { timeout: 8_000 })
        .then(() => true)
        .catch(() => false);

      if (!redirected) {
        console.log('');
        console.log('==================================================');
        console.log('[auth:google] デバイス認証が必要です。');
        console.log('[auth:google] ブラウザウィンドウで認証を完了してください。');
        console.log('==================================================');
        console.log('');
      }
    } else {
      console.log('[auth:google] GOOGLE_EMAIL/GOOGLE_PASSWORD not set — please log in manually.');
    }

    await page.waitForURL(
      (url) => !url.toString().includes('accounts.google.com'),
      { timeout: 300_000 },
    );

    const res = await page.goto(`${BASE_URL}/api/auth/status`);
    const json = (await res!.json()) as AuthStatus;
    if (!json.google.authenticated) {
      await browser.close();
      throw new Error('[auth:google] Google login did not complete. Please try again.');
    }

    await context.storageState({ path: AUTH_FILE });
    await browser.close();
    console.log('[auth:google] Session saved.');
  }

  // --- GitHub Connect ログイン ---
  if (status?.githubConnect.authenticated) {
    console.log('[auth:github-connect] Existing session is valid, reusing.');
    return;
  }

  console.log('[auth:github-connect] Opening browser for GitHub Connect login...');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: AUTH_FILE });
  const page = await context.newPage();

  // org を選択してから DB Apply ページへ
  await page.goto(`${BASE_URL}/api/auth/select-org?org_id=${TACHIIRI_ORG_ID}`, { waitUntil: 'networkidle' });
  await page.goto(`${BASE_URL}/DB%20Apply`, { waitUntil: 'networkidle' });

  // DB Apply ページの "GitHub Connect" リンクをクリック
  await page.click('a:has-text("GitHub Connect")');

  await waitForGitHubOAuth(
    page,
    process.env.GITHUB_USERNAME,
    process.env.GITHUB_PASSWORD,
    'github-connect',
  );

  const res = await page.goto(`${BASE_URL}/api/auth/status`);
  const json = (await res!.json()) as AuthStatus;
  if (!json.githubConnect.authenticated) {
    await browser.close();
    throw new Error('[auth:github-connect] GitHub Connect login did not complete. Please try again.');
  }

  await context.storageState({ path: AUTH_FILE });
  await browser.close();
  console.log('[auth:github-connect] Session saved.');
}

export default globalSetup;
