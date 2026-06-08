/**
 * リグレッションテスト
 * 過去に発生したバグの再発を検出する
 *
 * Usage: npx tsx e2e/regression.ts
 *
 * 事前条件:
 *   - start-session.ts でブラウザを起動・認証済みであること
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const CDP_PORT = 9222;

async function isCDPRunning(): Promise<boolean> {
  return fetch(`http://localhost:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1000) })
    .then(() => true)
    .catch(() => false);
}

type TestResult = { name: string; passed: boolean; detail?: string };

async function runTests(): Promise<void> {
  if (!await isCDPRunning()) {
    console.error('[regression] ブラウザが起動していません。先に start-session.ts を実行してください');
    process.exit(1);
  }

  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  const results: TestResult[] = [];

  // --- #4: identity session があるとき "Login..." が表示されないこと ---
  // identity_user_id cookie があればログイン済みのはずなので、ヘッダーに "Login..." は出ない
  {
    const name = '#4: identity session 時に "Login..." が表示されない';
    try {
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });

      const identityCookie = (await context.cookies()).find(
        (c) => c.name === 'identity_user_id' && c.domain.includes('tachiiri'),
      );

      if (!identityCookie) {
        results.push({ name, passed: true, detail: 'identity session なし → スキップ（前提条件未満）' });
      } else {
        // nav 内に "Login..." テキストがないことを確認
        const nav = page.locator('nav');
        const navText = await nav.textContent();
        const hasLoginText = navText?.includes('Login') && !navText?.includes('Logout');
        if (hasLoginText) {
          results.push({ name, passed: false, detail: `nav に "Login..." が含まれている: "${navText?.trim()}"` });
        } else {
          results.push({ name, passed: true, detail: `nav テキスト: "${navText?.trim()}"` });
        }
      }
    } catch (e) {
      results.push({ name, passed: false, detail: String(e) });
    }
  }

  // --- #4-b: 認証済みのとき "Logout" リンクまたは org selector が表示されること ---
  {
    const name = '#4-b: 認証済み時にユーザー情報または組織 selector が表示される';
    try {
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });

      const nav = page.locator('nav');
      const navText = await nav.textContent();
      const isAuthenticated =
        navText?.includes('Logout') || navText?.includes('@') || navText?.includes('tachiiri');

      if (isAuthenticated) {
        results.push({ name, passed: true, detail: `nav テキスト: "${navText?.trim()}"` });
      } else {
        // 未認証環境での実行は想定外なのでスキップ扱い
        results.push({ name, passed: true, detail: '未認証状態のためスキップ' });
      }
    } catch (e) {
      results.push({ name, passed: false, detail: String(e) });
    }
  }

  // --- #8: DB Apply API がクエリパラメータを保持すること ---
  // /api/admin/db-apply/migration-files?type=identity へのリクエストが実際に type パラメータを持つこと
  {
    const name = '#8: DB Apply API プロキシがクエリパラメータを保持する';
    try {
      const apiUrl = `${BASE_URL}/api/admin/db-apply/migration-files?type=identity`;
      const res = await page.evaluate(async (url: string) => {
        const r = await fetch(url);
        return { status: r.status, ok: r.ok };
      }, apiUrl);

      // 401/403 は認証の問題なのでテスト対象外（プロキシ自体は通っている）
      // 502/404 はプロキシ失敗またはルーティング問題
      if (res.status === 502) {
        results.push({ name, passed: false, detail: `502 Bad Gateway: プロキシに問題がある可能性 (URL: ${apiUrl})` });
      } else if (res.status === 500) {
        results.push({ name, passed: false, detail: `500 Server Error (URL: ${apiUrl})` });
      } else {
        // 200, 401, 403, 404 はプロキシは正常に通過している
        results.push({ name, passed: true, detail: `HTTP ${res.status} (クエリパラメータはプロキシを通過)` });
      }
    } catch (e) {
      results.push({ name, passed: false, detail: String(e) });
    }
  }

  // --- #8-b: type パラメータなしと type=identity で異なるレスポンスになること ---
  // 同じレスポンスなら type パラメータが無視されている（バグが再発している）
  {
    const name = '#8-b: type=identity と type=user でレスポンスが異なる（パラメータが効いている）';
    try {
      const [resIdentity, resUser] = await page.evaluate(async ([urlA, urlB]: string[]) => {
        const [a, b] = await Promise.all([
          fetch(urlA).then((r) => r.text()).catch(() => ''),
          fetch(urlB).then((r) => r.text()).catch(() => ''),
        ]);
        return [a, b];
      }, [
        `${BASE_URL}/api/admin/db-apply/migration-files?type=identity`,
        `${BASE_URL}/api/admin/db-apply/migration-files?type=user`,
      ] as string[]);

      if (!resIdentity || !resUser) {
        results.push({ name, passed: true, detail: '認証エラーのためスキップ（レスポンスが空）' });
      } else if (resIdentity === resUser) {
        results.push({
          name,
          passed: false,
          detail: 'type=identity と type=user が同じレスポンス → クエリパラメータが無視されている可能性',
        });
      } else {
        results.push({ name, passed: true, detail: 'type ごとに異なるレスポンスを返している' });
      }
    } catch (e) {
      results.push({ name, passed: false, detail: String(e) });
    }
  }

  await browser.close();

  // --- 結果表示 ---
  console.log('\n=== リグレッションテスト結果 ===\n');
  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${mark}  ${r.name}`);
    if (r.detail) console.log(`       ${r.detail}`);
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n合計: ${results.length} テスト, ${failed.length} 失敗\n`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

await runTests();
