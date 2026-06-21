import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
const r = await page.evaluate(async () => {
  const res = await fetch('/api/v1/d1/query', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({sql:'SELECT * FROM m_color LIMIT 30'})
  });
  return {status: res.status, body: await res.text()};
});
console.log(JSON.stringify(r, null, 2));
await b.close();
