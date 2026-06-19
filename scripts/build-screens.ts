/**
 * build-screens.ts
 *
 * Fetches all screen definitions from a deployed front worker and generates
 * static HTML files into public/. Run this during CI before `wrangler deploy`
 * so that screen pages become static assets baked into the Worker deployment.
 *
 * Environment variables:
 *   BASE_URL      — deployed worker origin, e.g. https://front-dev.tachiiri.workers.dev
 *   BUILD_TOKEN   — pre-shared token sent as x-build-token header (set as worker secret BUILD_SCREENS_TOKEN)
 *                   The worker uses DEFAULT_ORG_ID automatically when BUILD_TOKEN is valid.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, '');
if (!BASE_URL) {
  console.error('ERROR: BASE_URL env var is required');
  process.exit(1);
}

const BUILD_TOKEN = process.env.BUILD_TOKEN ?? '';

// ---------------------------------------------------------------------------
// Auth headers
// ---------------------------------------------------------------------------

const buildHeaders = (): HeadersInit => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (BUILD_TOKEN) {
    headers['x-build-token'] = BUILD_TOKEN;
  }

  return headers;
};

// ---------------------------------------------------------------------------
// Client JS path — read from src/client-path.ts (generated after vite build)
// ---------------------------------------------------------------------------

const resolveClientJsPath = (): string => {
  try {
    const src = readFileSync(resolve('src/client-path.ts'), 'utf-8');
    const match = src.match(/CLIENT_JS_PATH\s*=\s*'([^']+)'/);
    if (match) return match[1];
  } catch {
    // fall through
  }
  // Fallback: scan dist/.vite/manifest.json
  try {
    const manifest = JSON.parse(
      readFileSync(resolve('dist/.vite/manifest.json'), 'utf-8'),
    ) as Record<string, { file: string }>;
    const entry = manifest['src/web/client.ts'];
    if (entry) return `/${entry.file}`;
  } catch {
    // fall through
  }
  return '/assets/index.js';
};

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

const generateHtml = (screenName: string, screenJson: string, clientJsPath: string): string => {
  // Escape </script> in JSON to prevent early script tag close
  const safeJson = screenJson.replace(/<\/script>/gi, '<\\/script>');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(screenName)}</title>
</head>
<body>
<script id="__screen_data__" type="application/json">
${safeJson}
</script>
<script type="module" src="${escapeHtml(clientJsPath)}"></script>
</body>
</html>
`;
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

type ScreenListResponse = { items: { value: string; label: string }[] };

const fetchScreenList = async (): Promise<string[]> => {
  const url = `${BASE_URL}/api/layouts/json-files`;
  const res = await fetch(url, { headers: buildHeaders() });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as ScreenListResponse;
  return data.items.map((item) => item.value);
};

const fetchScreenData = async (screenName: string): Promise<string> => {
  const url = `${BASE_URL}/api/layouts/${encodeURIComponent(screenName)}`;
  const res = await fetch(url, { headers: buildHeaders() });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
};

// ---------------------------------------------------------------------------
// Login page static HTML
// ---------------------------------------------------------------------------

const generateLoginHtml = (clientJsPath: string): string => `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tempri</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f172a;color:#cbd5e1;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh}
.lc{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;width:100%;max-width:360px}
h1{color:#f1f5f9;font-size:24px;font-weight:700;margin-bottom:20px;text-align:center}
.ob{display:block;padding:10px 16px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#cbd5e1;font-size:14px;cursor:pointer;width:100%;font-family:monospace;text-decoration:none;text-align:center}
.ob+.ob{margin-top:8px}
#l-tabs{display:flex;border-bottom:1px solid #334155;margin-bottom:20px}
.ltab{background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-family:monospace;font-size:13px;padding:8px 16px;margin-bottom:-1px;color:#64748b}
.ltab.active{color:#f1f5f9;border-bottom-color:#3b82f6;font-weight:600}
#l-panel-new-group{display:none}
.linput{width:100%;padding:10px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#cbd5e1;font-size:14px;font-family:monospace;outline:none;display:block;margin-bottom:8px}
.lbtn{width:100%;padding:10px 16px;background:#3b82f6;border:none;border-radius:6px;color:#fff;font-size:14px;font-family:monospace;cursor:pointer;font-weight:600}
#l-ml-section{display:none}
.dv{display:flex;align-items:center;gap:12px;margin:16px 0;color:#64748b;font-size:12px}
.dv::before,.dv::after{content:'';flex:1;height:1px;background:#334155}
#l-status{margin-top:12px;font-size:13px;text-align:center;min-height:20px}
#l-err{background:#1f0a0a;border:1px solid #7f1d1d;border-radius:6px;color:#f87171;font-size:13px;padding:10px 12px;margin-bottom:16px;display:none}
</style>
</head>
<body>
<div class="lc">
  <h1>Tempri</h1>
  <div id="l-err">マジックリンクが無効または期限切れです</div>
  <div id="l-tabs">
    <button id="l-tab-login" class="ltab active">ログイン</button>
    <button id="l-tab-new-group" class="ltab">新規グループ作成</button>
  </div>
  <div id="l-panel-login">
    <a class="ob" href="/oauth/github/start">GitHub でログイン</a>
    <a class="ob" href="/oauth/google/start">Google でログイン</a>
    <a class="ob" href="/oauth/microsoft/start">Microsoft でログイン</a>
    <div id="l-ml-section">
      <div class="dv">または</div>
      <input type="email" id="l-email-login" class="linput" placeholder="メールアドレス">
      <button id="l-btn-login" class="lbtn">マジックリンクを送信</button>
    </div>
  </div>
  <div id="l-panel-new-group">
    <input type="text" id="l-group-name" class="linput" placeholder="グループ名">
    <input type="email" id="l-email" class="linput" placeholder="メールアドレス">
    <button id="l-btn" class="lbtn">マジックリンクを送信</button>
  </div>
  <div id="l-status"></div>
</div>
<script type="module" src="${escapeHtml(clientJsPath)}"></script>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const clientJsPath = resolveClientJsPath();
  console.log(`Client JS path: ${clientJsPath}`);

  // Output to dist/ (the Cloudflare Assets directory) so files are included in the deployment.
  // Vite copies public/ to dist/ during build, so we write directly to dist/ after the build.
  const outputDir = resolve('dist');
  mkdirSync(outputDir, { recursive: true });

  // Always generate login.html (independent of screen API)
  writeFileSync(resolve(outputDir, 'login.html'), generateLoginHtml(clientJsPath), 'utf-8');
  console.log('  wrote dist/login.html');

  console.log(`Fetching screen list from ${BASE_URL} …`);
  const screenNames = await fetchScreenList();
  console.log(`Found ${screenNames.length} screen(s): ${screenNames.join(', ')}`);

  let succeeded = 0;
  let failed = 0;

  for (const screenName of screenNames) {
    try {
      const screenJson = await fetchScreenData(screenName);
      const html = generateHtml(screenName, screenJson, clientJsPath);
      const outputPath = resolve(outputDir, `${screenName}.html`);
      writeFileSync(outputPath, html, 'utf-8');
      console.log(`  wrote dist/${screenName}.html`);
      succeeded++;
    } catch (err) {
      console.error(`  ERROR for screen "${screenName}":`, err);
      failed++;
    }
  }

  console.log(`\nDone: ${succeeded} succeeded, ${failed} failed.`);
  if (failed > 0) process.exit(1);
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
