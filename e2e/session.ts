/**
 * 会話中ずっと使い回すブラウザセッションのユーティリティ
 * - 初回: Chromium を起動してGitHubログイン（直接ログイン、Google経由なし）
 * - 以降: 同じブラウザにCDPで接続
 */
import './load-dev-vars.ts';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import * as OTPAuth from 'otpauth';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const BASE_URL = process.env.BASE_URL ?? 'https://front-production.tachiiri.workers.dev';
export const ENV_SLUG = BASE_URL.replace(/https?:\/\//, '').replace(/[^a-z0-9]/g, '-');
export const AUTH_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  `.auth/${ENV_SLUG}.json`,
);
export const TACHIIRI_ORG_ID = '9c95aa5e-5943-4dd0-9579-ed3725821979';
const CDP_PORT = 9222;
const PID_FILE = '/tmp/playwright-session.pid';

const GITHUB_TOTP_SECRET = process.env.GITHUB_TOTP_SECRET ?? '';
const GITHUB_EMAIL = process.env.GITHUB_EMAIL ?? process.env.GOOGLE_EMAIL ?? '';
const GITHUB_PASSWORD = process.env.GITHUB_PASSWORD ?? process.env.GOOGLE_PASSWORD ?? '';

export function generateTOTP() {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(GITHUB_TOTP_SECRET),
    digits: 6,
    period: 30,
  }).generate();
}

function isCDPRunning(): Promise<boolean> {
  return fetch(`http://localhost:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1000) })
    .then(() => true)
    .catch(() => false);
}

/** 既存のCDPブラウザに接続、なければ起動して認証 */
export async function getSession(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  if (await isCDPRunning()) {
    const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    return { browser, context, page };
  }

  // 新規起動
  const storageState = existsSync(AUTH_FILE) ? JSON.parse(readFileSync(AUTH_FILE, 'utf-8')) : undefined;
  const browser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${CDP_PORT}`, '--remote-debugging-address=0.0.0.0'],
  });
  writeFileSync(PID_FILE, String(process.pid));

  const context = await browser.newContext({
    storageState,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await ensureAuthOnPage(page, context);

  return { browser, context, page };
}

export async function ensureAuthOnPage(page: Page, context: BrowserContext) {
  const res = await page.goto(`${BASE_URL}/api/auth/status`);
  const status = await res!.json();
  console.log('[auth] status:', JSON.stringify(status));

  if (!status.google?.authenticated && !status.github?.authenticated) {
    await doGitHubLogin(page);
  }

  if (!status.githubConnect?.authenticated) {
    await doGitHubConnect(page);
  }

  await context.storageState({ path: AUTH_FILE });
}

/** GitHub に直接ログイン（メール + パスワード + TOTP）*/
async function doGitHubLogin(page: Page) {
  console.log('[auth] GitHub login...');
  await page.goto('https://github.com/login', { waitUntil: 'load' });

  // ログインフォームがある場合のみ認証（既ログイン時は不要）
  const loginField = await page.waitForSelector('#login_field', { timeout: 5_000 }).catch(() => null);
  if (loginField) {
    await page.fill('#login_field', GITHUB_EMAIL);
    await page.fill('#password', GITHUB_PASSWORD);
    await page.click('[name="commit"]');
    await page.waitForLoadState('networkidle');

    // 2FA (TOTP)
    if (page.url().includes('github.com/sessions/two-factor') && GITHUB_TOTP_SECRET) {
      await doTOTP(page);
      await page.waitForLoadState('networkidle');
    }
  } else {
    console.log('[auth] GitHub already logged in, url:', page.url());
  }
  console.log('[auth] GitHub login done, url:', page.url());

  // アプリの GitHub OAuth フローを実行
  await page.goto(`${BASE_URL}/oauth/github/start`, { waitUntil: 'networkidle' });

  // GitHub の OAuth 認証ページが出た場合は Authorize ボタンを押す
  if (page.url().includes('github.com/login/oauth/authorize') || page.url().includes('github.com')) {
    const authorizeBtn = page.locator('button:has-text("Authorize"), input[value="Authorize"]').first();
    if (await authorizeBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await authorizeBtn.click();
      await page.waitForLoadState('networkidle');
    }
  }

  await page.waitForURL((url) => url.toString().startsWith(BASE_URL), { timeout: 30_000 });
  console.log('[auth] GitHub OAuth done');
}

/** GitHub Connect (DB Apply 用の追加権限) */
async function doGitHubConnect(page: Page) {
  console.log('[auth] GitHub Connect...');
  await page.goto(`${BASE_URL}/api/auth/select-org?org_id=${TACHIIRI_ORG_ID}`, { waitUntil: 'networkidle' });
  await page.goto(`${BASE_URL}/DB%20Apply`, { waitUntil: 'networkidle' });

  const ghConnectLink = page.locator('a:has-text("GitHub Connect")').first();
  if (!await ghConnectLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
    console.log('[auth] GitHub Connect link not found, skipping');
    return;
  }
  await ghConnectLink.click({ force: true });
  await page.waitForLoadState('networkidle');
  console.log('[auth] GitHub Connect redirect:', page.url());

  // GitHub のログインページにリダイレクトされた場合 → すでにログイン済みなら
  // GitHub が自動で Authorize して戻るはず
  // OAuth 認証ページが出た場合は Authorize
  if (page.url().includes('github.com')) {
    const authorizeBtn = page.locator('button:has-text("Authorize"), input[value="Authorize"]').first();
    if (await authorizeBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await authorizeBtn.click();
      await page.waitForLoadState('networkidle');
    }

    // まだ GitHub にいる場合（ログインページ）→ TOTP が必要
    if (page.url().includes('github.com/sessions/two-factor') && GITHUB_TOTP_SECRET) {
      await doTOTP(page);
      await page.waitForLoadState('networkidle');
    }
  }

  await page.waitForURL((url) => url.toString().startsWith(BASE_URL), { timeout: 30_000 });
  console.log('[auth] GitHub Connect done');
}

async function doTOTP(page: Page) {
  // WebAuthn ページの場合は Authenticator app ページへ移動
  if (page.url().includes('/two-factor/webauthn') || page.url().includes('/two-factor')) {
    const appLink = page.locator('a:has-text("Authenticator app"), a[href*="/two-factor/app"]').first();
    if (await appLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await appLink.click();
      await page.waitForLoadState('networkidle').catch(() => {});
    } else {
      // More options を展開してから探す
      const moreOptions = page.locator('button:has-text("More options"), summary:has-text("More options")').first();
      if (await moreOptions.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await moreOptions.click();
        await page.waitForTimeout(500);
      }
      const appLink2 = page.locator('a:has-text("Authenticator app"), a[href*="/two-factor/app"]').first();
      if (await appLink2.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await appLink2.click();
        await page.waitForLoadState('networkidle').catch(() => {});
      }
    }
  }

  const code = generateTOTP();
  console.log(`[auth] TOTP: ${code}`);
  await page.fill('input[name="otp"], input[autocomplete="one-time-code"], input[type="text"]', code);
  await page.click('button[type="submit"], input[type="submit"]').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
}
