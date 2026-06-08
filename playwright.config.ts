import { defineConfig, devices } from '@playwright/test';
import { AUTH_FILE } from './e2e/auth.setup.ts';

const BASE_URL = process.env.BASE_URL ?? 'https://front-stage.tachiiri.workers.dev';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/auth.setup.ts',
  use: {
    baseURL: BASE_URL,
    storageState: AUTH_FILE,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
