import { chromium } from '@playwright/test';
(async () => {
  const b=await chromium.connectOverCDP('http://localhost:9222');
  const page=b.contexts()[0].pages()[0];
  await page.mouse.click(14,137); await page.waitForTimeout(700);          // expand システム
  await page.mouse.click({} as any).catch(()=>{});
  await page.mouse.move(50,162);
  await page.mouse.down({ button:'right' }); await page.mouse.up({ button:'right' }); // right-click ストレージ square → link
  await page.waitForTimeout(1000);
  await page.screenshot({ path:'/tmp/ge-dev-v8d.png', fullPage:true });
  console.log('ok');
  await b.close();
})();
