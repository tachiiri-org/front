// dev.shosai の正規 RP フローで認証し、3ペイン（左=一覧 / 中=データベース / 右=エディタ）を撮る。
// dev.shosai → dev.authn ログインページ →「GitHub でログイン」→ github ログイン → callback → shosai SPA。
// screenshot-uranai-dev.ts と同じ経路。ショサイ側はデータが空の状態から作って撮るので、
// 実行するたびにデータベースとページが1つずつ増える点に注意。
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import * as OTPAuth from 'otpauth';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = 'https://dev.shosai.tachiiri.com';
const OUT = process.env.OUT_DIR ?? '/tmp';
const env = (k: string) => (process.env[k] ?? process.env[`${k} `] ?? '').trim();

// セッションは使い回す。毎回 GitHub にログインし直すと再認可を要求され
// （"unusually high number of requests"）、そのうち通らなくなる。
// 保存済みの状態があればそれで始め、認証が切れていたときだけログインする。
const STATE = new URL('./.auth/dev-shosai.json', import.meta.url).pathname;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 950 },
  ...(existsSync(STATE) ? { storageState: STATE } : {}),
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[perr]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('response', (r) => { if (r.status() >= 400) console.log('[http]', r.status(), r.url()); });

// 既にショサイに入れるなら、GitHub には触らない。
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const alreadyIn = page.url().startsWith(BASE) && await page.locator('.s-wrap').count() > 0;
console.log('[auth] 保存済みセッション:', alreadyIn ? '有効' : '無効（ログインし直します）');

// github.com にログイン
if (!alreadyIn) {
await page.goto('https://github.com/login', { waitUntil: 'domcontentloaded' });
if (await page.waitForSelector('#login_field', { timeout: 4000 }).catch(() => null)) {
  await page.fill('#login_field', env('GITHUB_EMAIL'));
  await page.fill('#password', env('GITHUB_PASSWORD'));
  await page.click('[name="commit"]');
  await page.waitForLoadState('domcontentloaded');
  if (page.url().includes('/sessions/two-factor')) {
    // GitHub の 2FA 既定が webauthn になったので、TOTP の画面へ明示的に移る。
    if (page.url().includes('webauthn')) {
      await page.goto('https://github.com/sessions/two-factor/app', { waitUntil: 'domcontentloaded' });
    }
    const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(env('GITHUB_TOTP_SECRET')), digits: 6, period: 30 }).generate();
    let filled = false;
    for (const s of ['#app_totp', 'input[name="app_otp"]', 'input[autocomplete="one-time-code"]']) {
      if (await page.fill(s, code).then(() => true).catch(() => false)) { filled = true; break; }
    }
    if (!filled) console.log('!! TOTP 入力欄が見つからない url=' + page.url());
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
  }
  console.log('[auth] github logged in:', page.url());
} else console.log('[auth] github already logged in');
}

// RP フロー: dev.shosai → dev.authn ログインページ
if (!alreadyIn) {
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
console.log('[auth] login page url:', page.url());
const ghLogin = page.locator('button:has-text("Sign in with GitHub"), a:has-text("Sign in with GitHub"), button:has-text("GitHub でログイン")').first();
if (await ghLogin.isVisible({ timeout: 8000 }).catch(() => false)) {
  await ghLogin.click();
  console.log('[auth] clicked GitHub でログイン');
} else console.log('[auth] GitHub ログインボタン未検出 url=' + page.url());

// github authorize（既ログインなら自動 or Authorize）
await page.waitForTimeout(2500);
if (page.url().includes('github.com/login/oauth/authorize')) {
  const btn = page.locator('button[name="authorize"][value="1"], button:has-text("Authorize"), input[type="submit"][value*="Authorize" i]').first();
  if (await btn.isVisible({ timeout: 6000 }).catch(() => false)) { await btn.click(); console.log('[auth] Authorize クリック'); }
}

// dev.authn の組織選択ページ（select-org）で Authorize
await page.waitForTimeout(2500);
if (page.url().includes('/oauth/mcp/select-org')) {
  const orgAuth = page.locator('button:has-text("Authorize"), input[type="submit"][value*="Authorize" i]').first();
  if (await orgAuth.isVisible({ timeout: 6000 }).catch(() => false)) { await orgAuth.click(); console.log('[auth] 組織 Authorize クリック'); }
  else console.log('[auth] select-org だがボタン無し url=' + page.url());
}

await page.waitForURL((u) => u.toString().startsWith(BASE), { timeout: 40000 }).catch(() => console.log('[auth] dev.shosai に戻らず'));
await page.waitForTimeout(2500);
}
console.log('[auth] final url:', page.url());
// 次回のためにセッションを保存する。これで GitHub への再ログインを避けられる。
try { mkdirSync(new URL('./.auth/', import.meta.url).pathname, { recursive: true }); } catch { /* 既にある */ }
await ctx.storageState({ path: STATE });
if (!page.url().startsWith(BASE)) {
  await page.screenshot({ path: `${OUT}/shosai-auth-fail.png` });
  console.log('!! 認証失敗'); await browser.close(); process.exit(2);
}

// ReBAC の初期権限を播種する。新プロダクトの DO は j_relation が空で生まれ、
// 「認可はプロダクト間で引き継がない」ので graph の権限は流れて来ない。冪等なので毎回叩いてよい。
const seeded = await page.evaluate(async () => {
  const res = await fetch('/api/v1/shosai/admin/backfill-relations', { method: 'POST' });
  return { status: res.status, body: (await res.text()).slice(0, 200) };
});
console.log('[rebac] backfill:', seeded.status, seeded.body);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

// 3ペインが出るまで待つ
if (!await page.waitForSelector('.s-wrap', { timeout: 20000 }).catch(() => null)) {
  await page.screenshot({ path: `${OUT}/shosai-no-render.png` });
  console.log('!! .s-wrap 未描画 url=' + page.url());
  console.log('body:', (await page.locator('body').innerText()).slice(0, 400));
  await browser.close(); process.exit(3);
}
console.log('[shosai] 3ペイン描画 OK');
await page.screenshot({ path: `${OUT}/shosai-01-empty.png` });

// ── データベースを作る ──────────────────────────────────────────
page.once('dialog', () => { /* prompt は下の evaluate で潰す */ });
await page.evaluate(() => { window.prompt = () => 'タスク'; });
const addDb = page.locator('.s-side-head:has-text("データベース") .s-col-add-btn').first();
if (await addDb.isVisible({ timeout: 5000 }).catch(() => false)) {
  await addDb.click();
  await page.waitForTimeout(1800);
  console.log('[shosai] データベース作成');
} else console.log('!! データベース追加ボタン未検出');

// 列を3つ足す（テキスト / 選択 / 日付）
for (const [name, label] of [['担当', 'テキスト'], ['状態', '選択'], ['期限', '日付']] as const) {
  const colAdd = page.locator('.s-col-add-btn[title="列を追加"]').first();
  if (!await colAdd.isVisible({ timeout: 5000 }).catch(() => false)) { console.log('!! 列追加ボタン未検出'); break; }
  await colAdd.click();
  await page.waitForTimeout(400);
  await page.fill('.s-pop input.s-search', name).catch(() => {});
  await page.locator(`.s-pop .s-pop-item:has-text("${label}")`).first().click();
  await page.waitForTimeout(1200);
  console.log(`[shosai] 列を追加: ${name} (${label})`);
}

// 行を2つ足して、タイトルと値を入れる
for (const title of ['スキーマを確定する', 'Notion から移行する']) {
  const addRow = page.locator('.s-add-row:has-text("行を追加")').first();
  if (!await addRow.isVisible({ timeout: 5000 }).catch(() => false)) { console.log('!! 行追加ボタン未検出'); break; }
  await addRow.click();
  await page.waitForTimeout(1200);
  const last = page.locator('.s-row-ti').last();
  await last.fill(title);
  await last.blur();
  await page.waitForTimeout(800);
  console.log(`[shosai] 行を追加: ${title}`);
}
await page.screenshot({ path: `${OUT}/shosai-02-database.png` });

// ── ページを作ってブロックを書く ────────────────────────────────
const addPage = page.locator('.s-side-head:has-text("ページ") .s-col-add-btn').first();
if (await addPage.isVisible({ timeout: 5000 }).catch(() => false)) {
  await addPage.click();
  await page.waitForTimeout(1800);
  console.log('[shosai] ページ作成');
} else console.log('!! ページ追加ボタン未検出');

await page.fill('.s-editor .s-title', 'ショサイの設計メモ').catch(() => {});
await page.locator('.s-editor .s-title').blur().catch(() => {});
await page.waitForTimeout(600);

const first = page.locator('.s-add-row:has-text("最初のブロック")').first();
if (await first.isVisible({ timeout: 5000 }).catch(() => false)) {
  await first.click();
  await page.waitForTimeout(1200);
}

// Enter で次のブロックを作りながら書く。Tab でインデントも試す。
const lines: Array<[string, 'plain' | 'indent' | 'outdent']> = [
  ['テーブル規範に従う', 'plain'],
  ['ページはブロックの一種にする', 'indent'],
  ['順序は p_block_rank が持つ', 'plain'],
  ['挿入も移動も1リクエストで済む', 'indent'],
  ['本文は暗号化しない（全文検索のため）', 'outdent'],
];
for (const [text, how] of lines) {
  const ta = page.locator('.s-editor textarea.s-blk-in').last();
  if (!await ta.isVisible({ timeout: 5000 }).catch(() => false)) { console.log('!! ブロック入力未検出'); break; }
  if (how === 'indent') { await ta.press('Tab'); await page.waitForTimeout(900); }
  if (how === 'outdent') { await ta.press('Shift+Tab'); await page.waitForTimeout(900); }
  const cur = page.locator('.s-editor textarea.s-blk-in').last();
  await cur.fill(text);
  await cur.press('Enter');
  await page.waitForTimeout(1000);
  console.log(`[shosai] ブロック: ${text} (${how})`);
}
// 末尾に残った空ブロックを消す
await page.locator('.s-editor textarea.s-blk-in').last().press('Backspace').catch(() => {});
await page.waitForTimeout(1000);

await page.screenshot({ path: `${OUT}/shosai-03-editor.png` });

// ── 検索 ─────────────────────────────────────────────────────
await page.fill('.s-search[placeholder="全文検索"]', '順序').catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/shosai-04-search.png` });
console.log('[shosai] 検索結果件数:', await page.locator('.s-side-list .s-item').count());

// エラーバーが出ていないか
const err = page.locator('.s-err');
if (await err.isVisible().catch(() => false)) console.log('!! エラーバー:', await err.textContent());
else console.log('[shosai] エラーバーなし');

// 見た目で判断せず、API が返す depth と rank をそのまま出す。
const pageId = await page.evaluate(async () => {
  const r = await fetch('/api/v1/shosai/pages');
  const j = await r.json();
  return j.pages[0]?.id ?? null;
});
if (pageId) {
  const detail = await page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/shosai/page/${id}`);
    return r.json();
  }, pageId);
  console.log('[shosai] 文書順 (depth / rank / text):');
  for (const b of detail.blocks) console.log(`  ${'  '.repeat(b.depth)}[${b.depth}] ${b.rank}  ${b.text}`);
}
const eng = await page.evaluate(async () => {
  const out: Record<string, unknown> = {};
  for (const q of ['順序', '全文検索']) {
    const r = await fetch(`/api/v1/shosai/search?q=${encodeURIComponent(q)}`);
    const j = await r.json();
    out[q] = { engine: j.engine, hits: j.results.length, ftsError: j.ftsError };
  }
  return out;
});
console.log('[shosai] 検索:', JSON.stringify(eng));
console.log('[shosai] blocks:', await page.locator('.s-editor .s-blk').count());
console.log('[shosai] rows:', await page.locator('.s-tbl tbody tr').count());
console.log('[shosai] columns:', await page.locator('.s-tbl thead th').count());
await browser.close();
