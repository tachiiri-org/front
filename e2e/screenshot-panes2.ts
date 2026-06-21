import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
await page.goto('https://front-dev.tachiiri.workers.dev/graph-editor');
await new Promise(r => setTimeout(r, 3000));
await page.click('button:has-text("パネル")');
await new Promise(r => setTimeout(r, 2000));
// Add a second pane
await page.click('button[title="列を追加"]');
await new Promise(r => setTimeout(r, 500));
// Click source button of pane 2 (second "ルート" button)
const srcBtns = await page.$$('button:has-text("ルート")');
if (srcBtns[1]) {
  await srcBtns[1].click();
  await new Promise(r => setTimeout(r, 300));
}
await page.screenshot({ path: '/tmp/panes-two.png' });
await b.close();
