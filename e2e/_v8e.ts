import { chromium } from '@playwright/test';
(async () => {
  const b=await chromium.connectOverCDP('http://localhost:9222');
  const page=b.contexts()[0].pages()[0];
  await page.mouse.click(500,110); await page.waitForTimeout(400); // focus 関係本文(末尾付近)
  await page.keyboard.press('End');
  await page.keyboard.type(' @デー', { delay: 60 });               // @メンション検索
  await page.waitForTimeout(1200);
  await page.screenshot({ path:'/tmp/ge-dev-v8e.png', fullPage:true });
  console.log('ok');
  await b.close();
})();
