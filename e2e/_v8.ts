import { chromium } from '@playwright/test';
(async () => {
  const B='https://front-dev.tachiiri.workers.dev', G='word-graph-1', SYS='56a191b1-8b21-478a-b0ee-e8f8fc6d9017';
  const b=await chromium.connectOverCDP('http://localhost:9222');
  const ctx=b.contexts()[0]; const rq=ctx.request;
  // クリーン＋デモ関係（subject=システム, 本文あり）
  let ls=(await (await rq.get(`${B}/api/v1/graph/${G}/node/${SYS}/lines`)).json()).lines ?? [];
  for(const l of ls) for(const p of l.participants) await rq.delete(`${B}/api/v1/graph/${G}/line/${l.lineId}/ray/${p.id}`);
  await rq.post(`${B}/api/v1/graph/${G}/node/${SYS}/relation`, { data:{ lang:'ja', body:'システムはユーザーに価値を届ける' } });
  const page=ctx.pages()[0];
  await page.goto(`${B}/graph-editor`, { waitUntil:'networkidle' });
  await page.waitForTimeout(700);
  for(let i=0;i<5;i++){ const ps=page.locator('[data-pane-id]'); if(await ps.count()<=1)break; await ps.last().getByRole('button',{name:'×'}).click(); await page.waitForTimeout(200); }
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(900);
  await page.mouse.click(70,137); await page.waitForTimeout(900);   // select システム
  await page.screenshot({ path:'/tmp/ge-dev-v8a.png', fullPage:true });  // 関係パネルに本文行
  await page.mouse.click(420,92); await page.waitForTimeout(900);   // focus 関係行 → active → 四角塗り
  await page.screenshot({ path:'/tmp/ge-dev-v8b.png', fullPage:true });
  console.log('done');
  await b.close();
})();
