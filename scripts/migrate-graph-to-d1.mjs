/**
 * Migrates a word-graph from R2 JSON to a per-tenant D1 database.
 *
 * Modes:
 *   migrate  (default) — read R2 JSON → apply schema → insert into D1 → save R2 backup
 *   verify             — compare D1 content with R2 backup
 *   cleanup            — delete R2 backup after verification
 *
 * Usage:
 *   bun scripts/migrate-graph-to-d1.mjs --database-id <uuid> [--graph-id word-graph-1] [--dry-run]
 *   bun scripts/migrate-graph-to-d1.mjs --database-id <uuid> --verify [--graph-id word-graph-1]
 *   bun scripts/migrate-graph-to-d1.mjs --database-id <uuid> --cleanup [--graph-id word-graph-1]
 *
 * Requires:
 *   CLOUDFLARE_API_TOKEN env var (same one used by wrangler)
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Args ---
function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function flag(name) { return process.argv.includes(name); }

const GRAPH_ID    = arg('--graph-id') ?? 'word-graph-1';
const DATABASE_ID = arg('--database-id');
const INPUT_FILE  = arg('--input-file'); // skip R2, read local file instead
const DRY_RUN    = flag('--dry-run');
const VERIFY     = flag('--verify');
const CLEANUP    = flag('--cleanup');
const MODE       = VERIFY ? 'verify' : CLEANUP ? 'cleanup' : 'migrate';

const BUCKET      = 'bucket-dev';
const ACCOUNT_ID  = '523018f483c2fe955518358e24cbda76';
const R2_KEY      = `word-graphs/${GRAPH_ID}.json`;
const BACKUP_KEY  = `word-graphs/${GRAPH_ID}.backup.json`;
const SCHEMA_PATH = join(__dirname, '../../backend/d1/src/migrations/graph.sql');

if (!DATABASE_ID) {
  console.error('Error: --database-id is required');
  process.exit(1);
}

const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!CF_TOKEN) {
  console.error('Error: CLOUDFLARE_API_TOKEN env var is required');
  process.exit(1);
}

// --- D1 REST API ---
async function d1Query(sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    },
  );
  const body = await res.json();
  if (!res.ok || !body.success) {
    throw new Error(`D1 error: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.result?.[0];
}

async function d1Batch(statements) {
  for (const stmt of statements) {
    await d1Query(stmt.sql, stmt.params);
  }
}

// --- R2 helpers (wrangler CLI) ---
function r2Get(key) {
  const tmp = join(tmpdir(), `r2-${Date.now()}.json`);
  try {
    execSync(`wrangler r2 object get ${BUCKET}/${key} --file ${tmp} --remote`, { stdio: 'pipe' });
    return JSON.parse(readFileSync(tmp, 'utf-8'));
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function r2Put(key, data) {
  const tmp = join(tmpdir(), `r2-put-${Date.now()}.json`);
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    execSync(
      `wrangler r2 object put ${BUCKET}/${key} --file ${tmp} --content-type application/json --remote`,
      { stdio: 'inherit' },
    );
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function r2Delete(key) {
  execSync(`wrangler r2 object delete ${BUCKET}/${key} --remote`, { stdio: 'inherit' });
}

// --- Chunk helper ---
function chunks(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ============================================================
// MODE: migrate
// ============================================================
async function migrate() {
  console.log(`[migrate] graph=${GRAPH_ID} db=${DATABASE_ID}${DRY_RUN ? ' DRY-RUN' : ''}`);

  // 1. Read graph JSON (local file or R2)
  let graph;
  if (INPUT_FILE) {
    console.log(`Reading local file: ${INPUT_FILE}`);
    graph = JSON.parse(readFileSync(INPUT_FILE, 'utf-8'));
  } else {
    console.log(`Reading R2: ${R2_KEY}`);
    graph = r2Get(R2_KEY);
  }
  const words = graph.words ?? [];
  const texts = graph.texts ?? [];
  console.log(`  ${words.length} words, ${texts.length} texts`);

  // 2. Apply schema
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  const stmts = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  if (DRY_RUN) {
    console.log('\n-- Schema SQL (dry-run) --');
    stmts.forEach(s => console.log(s + ';\n'));
  } else {
    console.log('Applying schema...');
    for (const sql of stmts) {
      await d1Query(sql);
    }
    console.log('  Schema applied.');
  }

  // 3. Build insert statements
  const inserts = [];

  inserts.push({ sql: 'INSERT OR IGNORE INTO graphs (id, name) VALUES (?, ?)', params: [GRAPH_ID, GRAPH_ID] });

  // Collect unique colors
  const colorMap = new Map(); // code → id
  for (const w of words) {
    if (w.color && !colorMap.has(w.color)) {
      colorMap.set(w.color, crypto.randomUUID());
    }
  }
  for (const [code, id] of colorMap) {
    inserts.push({ sql: 'INSERT OR IGNORE INTO colors (id, code) VALUES (?, ?)', params: [id, code] });
  }

  for (const w of words) {
    inserts.push({ sql: 'INSERT OR IGNORE INTO words (id, text) VALUES (?, ?)', params: [w.id, w.text] });
    inserts.push({ sql: 'INSERT OR IGNORE INTO graph_words (graph_id, word_id) VALUES (?, ?)', params: [GRAPH_ID, w.id] });
    if (w.color) {
      const colorId = colorMap.get(w.color);
      inserts.push({ sql: 'INSERT OR IGNORE INTO word_colors (word_id, color_id) VALUES (?, ?)', params: [w.id, colorId] });
    }
  }

  for (const t of texts) {
    // Drop heartbeat — not stored in D1
    inserts.push({ sql: 'INSERT OR IGNORE INTO texts (id, text) VALUES (?, ?)', params: [t.id, t.text] });
    inserts.push({ sql: 'INSERT OR IGNORE INTO graph_texts (graph_id, text_id) VALUES (?, ?)', params: [GRAPH_ID, t.id] });
    for (const wordId of (t.wordIds ?? [])) {
      inserts.push({ sql: 'INSERT OR IGNORE INTO text_words (text_id, word_id) VALUES (?, ?)', params: [t.id, wordId] });
    }
  }

  if (DRY_RUN) {
    console.log(`\n-- ${inserts.length} insert statements (dry-run, not shown) --`);
    console.log('Colors:', [...colorMap.keys()]);
    return;
  }

  // 4. Execute inserts in batches of 50
  console.log(`Inserting ${inserts.length} statements...`);
  for (const batch of chunks(inserts, 50)) {
    await d1Batch(batch);
  }
  console.log('  Inserted.');

  // 5. Save backup to R2 (original JSON is kept intact)
  console.log(`Saving backup: ${BACKUP_KEY}`);
  r2Put(BACKUP_KEY, graph);

  console.log('\nDone. Verify with:');
  console.log(`  bun scripts/migrate-graph-to-d1.mjs --database-id ${DATABASE_ID} --verify`);
}

// ============================================================
// MODE: verify
// ============================================================
async function verify() {
  console.log(`[verify] graph=${GRAPH_ID} db=${DATABASE_ID}`);

  // Read backup
  console.log(`Reading backup: ${BACKUP_KEY}`);
  const backup = r2Get(BACKUP_KEY);
  const bWords = new Map((backup.words ?? []).map(w => [w.id, w]));
  const bTexts = new Map((backup.texts ?? []).map(t => [t.id, t]));

  // Query D1
  const [gWords, gTexts, gTextWords] = await Promise.all([
    d1Query('SELECT w.id, w.text FROM words w JOIN graph_words gw ON gw.word_id = w.id WHERE gw.graph_id = ?', [GRAPH_ID]),
    d1Query('SELECT t.id, t.text FROM texts t JOIN graph_texts gt ON gt.text_id = t.id WHERE gt.graph_id = ?', [GRAPH_ID]),
    d1Query(
      'SELECT tw.text_id, tw.word_id FROM text_words tw ' +
      'JOIN graph_texts gt ON gt.text_id = tw.text_id WHERE gt.graph_id = ?',
      [GRAPH_ID],
    ),
  ]);

  const dWords = new Map((gWords.results ?? []).map(r => [r.id, r]));
  const dTexts = new Map((gTexts.results ?? []).map(r => [r.id, r]));

  let ok = true;

  // Words
  for (const [id, w] of bWords) {
    if (!dWords.has(id)) { console.error(`  MISSING word: ${w.text} (${id})`); ok = false; }
    else if (dWords.get(id).text !== w.text) { console.error(`  MISMATCH word text: ${id}`); ok = false; }
  }
  for (const id of dWords.keys()) {
    if (!bWords.has(id)) { console.error(`  EXTRA word in D1: ${id}`); ok = false; }
  }

  // Texts
  for (const [id, t] of bTexts) {
    if (!dTexts.has(id)) { console.error(`  MISSING text: ${t.text.slice(0, 40)} (${id})`); ok = false; }
    else if (dTexts.get(id).text !== t.text) { console.error(`  MISMATCH text: ${id}`); ok = false; }
  }
  for (const id of dTexts.keys()) {
    if (!bTexts.has(id)) { console.error(`  EXTRA text in D1: ${id}`); ok = false; }
  }

  // text_words
  const twIndex = new Set((gTextWords.results ?? []).map(r => `${r.text_id}:${r.word_id}`));
  for (const t of backup.texts ?? []) {
    for (const wordId of (t.wordIds ?? [])) {
      if (!twIndex.has(`${t.id}:${wordId}`)) {
        console.error(`  MISSING text_word: text=${t.id} word=${wordId}`);
        ok = false;
      }
    }
  }

  if (ok) {
    console.log(`\nOK — D1 matches backup (${bWords.size} words, ${bTexts.size} texts)`);
    console.log('Cleanup when ready:');
    console.log(`  bun scripts/migrate-graph-to-d1.mjs --database-id ${DATABASE_ID} --cleanup`);
  } else {
    console.error('\nVERIFY FAILED — do not delete backup');
    process.exit(1);
  }
}

// ============================================================
// MODE: cleanup
// ============================================================
async function cleanup() {
  console.log(`[cleanup] deleting backup: ${BACKUP_KEY}`);
  r2Delete(BACKUP_KEY);
  console.log('Backup deleted.');
  console.log('Note: original R2 JSON (word-graphs/${GRAPH_ID}.json) is still present.');
  console.log('Delete it after MCP tools and frontend are switched to D1.');
}

// ============================================================
const run = { migrate, verify, cleanup }[MODE];
run().catch(e => { console.error(e); process.exit(1); });
