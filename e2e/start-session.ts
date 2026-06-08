/**
 * 会話開始時に1回実行するスクリプト
 * - Chromiumを独立プロセスとして起動
 * - CDP port 9222でブラウザを維持（このスクリプトが終了してもブラウザは生きている）
 * - GitHub認証まで完了させる
 * - 以降の screenshot.ts などは connectOverCDP で接続する
 *
 * Usage: npx tsx e2e/start-session.ts
 * Stop:  kill $(cat /tmp/playwright-chrome.pid)
 */
import './load-dev-vars.ts';
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { ensureAuthOnPage, BASE_URL, AUTH_FILE } from './session.ts';

const CDP_PORT = 9222;
const PID_FILE = '/tmp/playwright-chrome.pid';
const USER_DATA_DIR = '/tmp/playwright-chrome-data';

async function isCDPRunning(): Promise<boolean> {
  return fetch(`http://localhost:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1000) })
    .then(() => true)
    .catch(() => false);
}

async function waitForCDP(maxMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await isCDPRunning()) return;
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Chromium CDP did not start in time');
}

// すでに起動中なら認証だけ確認して終了
if (await isCDPRunning()) {
  console.log('[session] 既存のブラウザに接続します...');
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();
  await ensureAuthOnPage(page, context);
  await browser.close();
  console.log('[session] ready (既存ブラウザ)');
  process.exit(0);
}

// Chromiumのパスを取得
const chromiumExec = chromium.executablePath();
console.log('[session] Chromiumを起動:', chromiumExec);

if (!existsSync(USER_DATA_DIR)) {
  mkdirSync(USER_DATA_DIR, { recursive: true });
}

// 独立プロセスとして起動（このスクリプト終了後も生きる）
const proc = spawn(chromiumExec, [
  `--remote-debugging-port=${CDP_PORT}`,
  '--remote-debugging-address=0.0.0.0',
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  `--user-data-dir=${USER_DATA_DIR}`,
], {
  detached: true,
  stdio: 'ignore',
});
proc.unref();
writeFileSync(PID_FILE, String(proc.pid));
console.log(`[session] Chromium PID: ${proc.pid}`);

// CDP が起動するまで待機
await waitForCDP();
console.log('[session] CDP ready');

// 認証
const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const context = browser.contexts()[0] ?? await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const page = context.pages()[0] ?? await context.newPage();
await ensureAuthOnPage(page, context);
await page.goto(`${BASE_URL}/DB%20Apply`, { waitUntil: 'networkidle' });
console.log('[session] ready ->', page.url());
await browser.close();

console.log('[session] ブラウザはバックグラウンドで動作中です');
console.log(`[session] 停止: kill $(cat ${PID_FILE})`);
