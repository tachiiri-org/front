import { chromium } from 'playwright';

const BASE_URL = 'https://front-dev.tachiiri.workers.dev';

async function run() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = await context.newPage();

  // Try GitHub Connect on dev
  await page.goto(`${BASE_URL}/oauth/github/connect/start`, { waitUntil: 'networkidle' });
  console.log('After connect start URL:', page.url());
  await page.waitForTimeout(2000);

  if (page.url().includes('github.com')) {
    console.log('GitHub OAuth needed...');
    const authBtn = await page.$('button[name="authorize"]');
    if (authBtn) {
      await authBtn.click();
      await page.waitForURL(url => url.toString().startsWith(BASE_URL), { timeout: 30_000 });
      console.log('GitHub Connect done:', page.url());
    } else {
      console.log('No authorize button found, page:', await page.evaluate(() => document.body.innerText.slice(0, 500)));
    }
  } else {
    console.log('No GitHub OAuth needed, already at:', page.url());
  }

  // Now try DB Apply
  await page.goto(`${BASE_URL}/DB%20Apply`, { waitUntil: 'networkidle' });
  console.log('DB Apply URL:', page.url());
  await page.waitForTimeout(3000);

  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 8000));
  console.log('=== DB Apply Content ===');
  console.log(bodyText);

  await page.screenshot({ path: '/tmp/db-apply-dev3.png', fullPage: true });
  console.log('Screenshot saved to /tmp/db-apply-dev3.png');
  await page.close();
}

run().catch(e => { console.error(e); process.exit(1); });
