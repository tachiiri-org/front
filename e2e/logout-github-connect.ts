import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL ?? 'https://front-production.tachiiri.workers.dev';
const ENV_SLUG = BASE_URL.replace(/https?:\/\//, '').replace(/[^a-z0-9]/g, '-');
const AUTH_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), `.auth/${ENV_SLUG}.json`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: AUTH_FILE });
const page = await context.newPage();

// GitHub Connect ログアウト
const res = await page.goto(`${BASE_URL}/api/auth/github/logout`, { waitUntil: 'networkidle' });
console.log('logout status:', res?.status());

// 確認
const statusRes = await page.goto(`${BASE_URL}/api/auth/status`);
const json = await statusRes!.json();
console.log('after logout:', JSON.stringify(json, null, 2));

// ログアウト後のセッションを保存
await context.storageState({ path: AUTH_FILE });
await browser.close();
