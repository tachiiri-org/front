/**
 * build-screens.ts
 *
 * Fetches all screen definitions from a deployed front worker and generates
 * static HTML files into public/. Run this during CI before `wrangler deploy`
 * so that screen pages become static assets baked into the Worker deployment.
 *
 * Environment variables:
 *   BASE_URL            — deployed worker origin, e.g. https://front-dev.tachiiri.workers.dev
 *   BUILD_TOKEN         — pre-shared token sent as x-build-token header (set as worker secret BUILD_SCREENS_TOKEN)
 *   IDENTITY_ORG_ID     — org ID cookie value (alternative auth: cookie-based)
 *   IDENTITY_USER_ID    — user ID cookie value (alternative auth: cookie-based)
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
const IDENTITY_ORG_ID = process.env.IDENTITY_ORG_ID ?? '';
const IDENTITY_USER_ID = process.env.IDENTITY_USER_ID ?? '';

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

  const cookieParts: string[] = [];
  if (IDENTITY_ORG_ID) cookieParts.push(`identity_org_id=${encodeURIComponent(IDENTITY_ORG_ID)}`);
  if (IDENTITY_USER_ID) cookieParts.push(`identity_user_id=${encodeURIComponent(IDENTITY_USER_ID)}`);
  if (cookieParts.length > 0) {
    headers['Cookie'] = cookieParts.join('; ');
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
// Main
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const clientJsPath = resolveClientJsPath();
  console.log(`Client JS path: ${clientJsPath}`);

  const publicDir = resolve('public');
  mkdirSync(publicDir, { recursive: true });

  console.log(`Fetching screen list from ${BASE_URL} …`);
  const screenNames = await fetchScreenList();
  console.log(`Found ${screenNames.length} screen(s): ${screenNames.join(', ')}`);

  let succeeded = 0;
  let failed = 0;

  for (const screenName of screenNames) {
    try {
      const screenJson = await fetchScreenData(screenName);
      const html = generateHtml(screenName, screenJson, clientJsPath);
      const outputPath = resolve(publicDir, `${screenName}.html`);
      writeFileSync(outputPath, html, 'utf-8');
      console.log(`  wrote public/${screenName}.html`);
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
