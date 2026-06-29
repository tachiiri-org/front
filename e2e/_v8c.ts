import { chromium } from '@playwright/test';
(async () => {
  const b=await chromium.connectOverCDP('http://localhost:9222');
  const page=b.contexts()[0].pages()[0];
  await page.mouse.click(420,110); await page.waitForTimeout(1000);  // focus 関係本文 → active relation
  await page.screenshot({ path:'/tmp/ge-dev-v8c.png', fullPage:true });
  console.log('ok');
  await b.close();
})();
