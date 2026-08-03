/**
 * 家計簿画面のスクリーンショットを撮る（ライト/ダーク両方）。
 *
 * 製品ホストは認証を authn に委譲するので、保存済みの認証状態に authn の Cookie が
 * 入っていれば、kakeibo 側のセッションは OIDC のリダイレクトで自動的に確立される。
 *
 * 使い方: npx tsx e2e/screenshot-kakeibo.ts [dev|stage|production]
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const ENV = process.argv[2] ?? 'dev';
const HOST =
  ENV === 'production' ? 'kakeibo.tachiiri.com'
  : ENV === 'stage' ? 'stage.kakeibo.tachiiri.com'
  : 'dev.kakeibo.tachiiri.com';
// 認証は authn 側に集約されているので、同じ環境の graph 用に保存した状態を流用する
const AUTH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  `.auth/${ENV === 'production' ? '' : ENV + '-'}graph-tachiiri-com.json`,
);
const OUT = path.dirname(fileURLToPath(import.meta.url));

if (!existsSync(AUTH)) {
  console.error(`認証状態が見つかりません: ${AUTH}`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

for (const scheme of ['light', 'dark'] as const) {
  const ctx = await browser.newContext({
    storageState: AUTH,
    viewport: { width: 1400, height: 900 },
    locale: 'ja-JP',
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 160)));

  await page.goto(`https://${HOST}/import`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // OIDC のリダイレクトが数回挟まるので落ち着くまで待つ
  await page.waitForTimeout(6000);

  const authed = await page.locator('.kk').count();
  console.log(`[${scheme}] url=${page.url()}`);
  console.log(`[${scheme}] 家計簿画面=${authed ? 'あり' : 'なし（未認証の可能性）'} title=${await page.title()}`);
  if (errs.length) console.log(`[${scheme}] consoleエラー:`, errs);

  const file = path.join(OUT, `kakeibo-${ENV}-${scheme}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[${scheme}] saved ${file}`);
  await ctx.close();
}

await browser.close();
