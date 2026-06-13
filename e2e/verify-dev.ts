import { chromium } from '@playwright/test';

const CDP_PORT = 9222;
const BASE_URL = 'https://front-dev.tachiiri.workers.dev';

async function main() {
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  await page.goto(`${BASE_URL}/word-graph-1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Check font styles of inputs
  const fontStyles = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input'));
    return inputs.slice(0, 10).map(inp => ({
      fontStyle: (inp as HTMLElement).style.fontStyle || getComputedStyle(inp).fontStyle,
      value: inp.value.slice(0, 20),
    }));
  });
  console.log('Input font styles:', JSON.stringify(fontStyles, null, 2));

  await page.screenshot({ path: '/tmp/screenshot-wg2.png', fullPage: false });
  console.log('Screenshot saved: /tmp/screenshot-wg2.png');

  await browser.disconnect();
}

main().catch(console.error);
