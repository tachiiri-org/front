import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import { BASE_URL } from './session.ts';

const DB_IDS = {
  dev: '38652751-ca79-47ae-ac3f-92b59088e11e',
  stage: '20dfc9c6-170c-47e7-927c-d703918a6449',
  production: '01fc4992-e113-435a-be70-226cddcfa092',
};

async function runSql(page: Parameters<typeof fetch>[0] extends never ? never : any, dbId: string, sql: string) {
  const res = await page.evaluate(async ([base, db, s]: [string, string, string]) => {
    const r = await fetch(`${base}/api/viewer/d1/${db}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: s }),
    });
    const text = await r.text();
    return { status: r.status, body: text.slice(0, 800) };
  }, [BASE_URL, dbId, sql] as [string, string, string]);
  return res;
}

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(`${BASE_URL}/Migration%20Admin`);

  for (const env of ['dev', 'stage', 'production'] as const) {
    const dbId = DB_IDS[env];
    console.log(`\n========== ${env} (${dbId}) ==========`);
    
    // Check current state
    const check = await runSql(page, dbId, `SELECT name, sql FROM sqlite_master WHERE name = 'j_user_group_default'`);
    console.log(`Current schema HTTP ${check.status}: ${check.body}`);
    
    if (check.status !== 200) {
      console.log(`Skipping ${env} - cannot query`);
      continue;
    }
    
    // Apply migration 0017 statements one by one
    const statements = [
      `PRAGMA foreign_keys = OFF`,
      `CREATE TABLE j_user_group_default_fixed (user_id TEXT NOT NULL PRIMARY KEY REFERENCES m_user(id), group_id TEXT NOT NULL REFERENCES m_group(id))`,
      `INSERT INTO j_user_group_default_fixed SELECT * FROM j_user_group_default`,
      `DROP TABLE j_user_group_default`,
      `ALTER TABLE j_user_group_default_fixed RENAME TO j_user_group_default`,
      `PRAGMA foreign_keys = ON`,
    ];
    
    let success = true;
    for (const sql of statements) {
      const res = await runSql(page, dbId, sql);
      console.log(`  [${res.status}] ${sql.slice(0, 60)}`);
      if (res.status !== 200) {
        console.log(`  ERROR: ${res.body}`);
        success = false;
        break;
      }
    }
    
    if (success) {
      // Verify result
      const verify = await runSql(page, dbId, `SELECT name, sql FROM sqlite_master WHERE name = 'j_user_group_default'`);
      console.log(`\nVerification: ${verify.body.slice(0, 300)}`);
    }
  }

  await browser.close();
}

main().catch(console.error);
