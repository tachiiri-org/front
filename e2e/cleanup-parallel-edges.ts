/**
 * Cleanup script: remove duplicate parallel edges (same source→target in m_edge).
 *
 * The children API now deduplicates responses, so direct API inspection won't reveal
 * parallel edges. Instead this script uses toggle-link to probe and clean:
 * - Toggle once: removes the first parallel edge (linked→false but link may still exist)
 * - Re-fetch children: if the node is still there, a second edge existed
 * - If node still present: toggle again to remove second edge, then toggle once more to restore
 * - If node gone: re-add with one more toggle (restore single edge)
 *
 * Usage:
 *   npx tsx e2e/cleanup-parallel-edges.ts               # check only (reads children, counts via toggle probe)
 *   npx tsx e2e/cleanup-parallel-edges.ts --apply       # fix (remove extra parallel edges)
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';

const TARGET = 'https://front-production.tachiiri.workers.dev';
const GRAPH = 'word-graph-1';
const DRY_RUN = !process.argv.includes('--apply');

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto(`${TARGET}/graph-editor`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

// Helper: fetch children of a node (API response may be deduped, but that's fine for existence check)
const fetchChildren = async (parentId: string): Promise<Array<{ id: string; ja?: string; en?: string }>> => {
  return page.evaluate(async ({ graph, nodeId }) => {
    const r = await fetch(`/api/graph/${graph}/node/${nodeId}/children?limit=500`, { credentials: 'include' });
    const d = await r.json() as { nodes: Array<{ id: string; ja?: string; en?: string }> };
    return d.nodes ?? [];
  }, { graph: GRAPH, nodeId: parentId });
};

// Helper: toggle link and return new linked state
const toggle = async (sourceId: string, targetId: string): Promise<boolean> => {
  return page.evaluate(async ({ graph, sourceId, targetId }) => {
    const r = await fetch(`/api/graph/${graph}/node/${sourceId}/link`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId }),
    });
    const d = await r.json() as { linked: boolean };
    return d.linked;
  }, { graph: GRAPH, sourceId, targetId });
};

// Get bookmarks
const bookmarks = await page.evaluate(async ({ graph }) => {
  const r = await fetch(`/api/graph/${graph}/bookmarks`, { credentials: 'include' });
  const d = await r.json() as { bookmarks: string[] };
  return d.bookmarks ?? [];
}, { graph: GRAPH });

console.log(`Probing ${bookmarks.length} bookmark nodes for parallel edges...`);
console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (check only)' : 'APPLY (will fix)'}\n`);

let foundParallel = 0;
let fixed = 0;

for (const parentId of bookmarks) {
  const children = await fetchChildren(parentId);
  const childLabels = new Map(children.map((n) => [n.id, n.ja ?? n.en ?? n.id]));

  for (const [childId, label] of childLabels) {
    // Probe: remove one edge
    const afterFirstToggle = await toggle(parentId, childId);

    if (afterFirstToggle) {
      // This shouldn't happen — toggle creates an edge, meaning there was none before.
      // Restore by toggling again.
      console.log(`  WARN: ${label} — first toggle added edge (was absent?), restoring...`);
      await toggle(parentId, childId);
      continue;
    }

    // afterFirstToggle=false means we removed one edge.
    // Now check if child is still present (parallel edge exists).
    await new Promise((r) => setTimeout(r, 200));
    const childrenAfter = await fetchChildren(parentId);
    const stillPresent = childrenAfter.some((n) => n.id === childId);

    if (!stillPresent) {
      // Only one edge existed — restore it.
      await toggle(parentId, childId);
      continue;
    }

    // Parallel edge confirmed: child still present after removing first edge.
    foundParallel++;
    console.log(`  PARALLEL: "${label}" (${childId.slice(0, 8)}…) under parent ${parentId.slice(0, 8)}…`);

    if (DRY_RUN) {
      // Restore the edge we removed.
      await toggle(parentId, childId);
      continue;
    }

    // APPLY: remove remaining edge(s) until node disappears, then restore one.
    let stillThere = true;
    let extraRemoved = 1; // already removed one
    while (stillThere) {
      const linked = await toggle(parentId, childId);
      if (!linked) extraRemoved++;
      await new Promise((r) => setTimeout(r, 200));
      const check = await fetchChildren(parentId);
      stillThere = check.some((n) => n.id === childId);
    }
    // Re-add a single clean edge.
    await toggle(parentId, childId);
    fixed++;
    console.log(`  FIXED: removed ${extraRemoved - 1} extra edge(s), re-added 1 clean edge.`);
  }
}

if (foundParallel === 0) {
  console.log('No parallel edges detected. DB is clean.');
} else if (DRY_RUN) {
  console.log(`\nFound ${foundParallel} parallel edge pair(s). Re-run with --apply to fix.`);
} else {
  console.log(`\nFixed ${fixed}/${foundParallel} pair(s).`);
}

await browser.close();
