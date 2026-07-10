import { chromium } from '@playwright/test';
(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9222');
  const page = b.contexts()[0].pages()[0];
  const SYS='56a191b1-8b21-478a-b0ee-e8f8fc6d9017';
  const G='/api/v1/graph/word-graph-1';
  await page.goto('https://front-production.tachiiri.workers.dev/graph-editor',{waitUntil:'networkidle'});
  await page.waitForTimeout(1500);
  const out = await page.evaluate(`(async()=>{
    const j=u=>fetch(u).then(r=>r.status===200?r.json():({status:r.status}));
    const tree=await j('${G}/tree');
    const sysChildren=await j('${G}/node/${SYS}/children?limit=100');
    // does the graph list know word-graph-1?
    const graphs=await j('${G}');
    return {
      treeNodes:(tree.nodes||[]).length, treeParents:Object.keys(tree.parents||{}).length, treeStatus:tree.status,
      sysChildrenCount:(sysChildren.nodes||[]).length, sysChildrenStatus:sysChildren.status,
      loc: location.href,
    };
  })()`);
  console.log(JSON.stringify(out));
  await b.close();
})();
