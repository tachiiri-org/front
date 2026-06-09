import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();

const envs = ['production', 'stage', 'development'] as const;
const tabs = ['Identity', 'User DB'] as const;

for (const env of envs) {
  const baseUrl = {
    production: 'https://front-production.tachiiri.workers.dev',
    stage: 'https://front-stage.tachiiri.workers.dev',
    development: 'https://front-dev.tachiiri.workers.dev',
  }[env];

  await page.goto(`${baseUrl}/db-migrate`, { waitUntil: 'networkidle' });

  // GitHub Connect if needed
  const needsAuth = await page.locator('text=GitHub Connect login required').isVisible({ timeout: 3000 }).catch(() => false);
  if (needsAuth) {
    await page.locator('a, button').filter({ hasText: /GitHub Connect/i }).first().click();
    await page.waitForTimeout(3000);
  }

  for (const tab of tabs) {
    const tabEl = page.locator('button, [role="tab"]').filter({ hasText: new RegExp(`^${tab}$`) }).first();
    if (await tabEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tabEl.click();
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: `/tmp/db-migrate-${env}-${tab.replace(' ', '-')}.png` });
    console.log(`Saved: ${env} / ${tab}`);
  }
}

await browser.close();
console.log('Done');
