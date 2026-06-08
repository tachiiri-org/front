import { test, expect } from '@playwright/test';

test('google auth is valid', async ({ page }) => {
  const res = await page.goto('/api/auth/status');
  expect(res?.ok()).toBe(true);
  const json = await res!.json();
  expect(json.google.authenticated).toBe(true);
});
