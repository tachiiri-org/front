import type { ExplorerNode, GraphEditorContext } from './types';
import type { OutlinerPaneOpts, PathEntry } from './outliner-view';
import { TEXT_HIGH, TEXT_MID, TEXT_DIM } from './constants';
import { fetchChildren, fetchNeighbors, fetchRelations } from './api';

// Read-only "relation" view: shows a focus node's edges grouped by relation. Deliberately does
// NOT reuse the outliner's containment cache / editing machinery — relation browsing is read-mostly
// and a node has many neighbour-sets (one per relation), not a single editable children tree.
//
// 含有 (containment) = the node's children (existing /children endpoint; works on untyped legacy
// edges, no relabel needed). Other relations = lines from the neighbors+edges API, grouped by
// relation_id, with direction (→ outgoing / ← incoming / — undirected) from the line's source.
//
// Returns an object shaped like the outliner view so the multi-pane can host it without special
// casing (the caller casts it to the outliner's type); unused outliner methods are inert no-ops.

type Dir = '▼' | '→' | '←' | '—';
type RelGroup = { name: string; color: string; rows: Array<{ node: ExplorerNode; dir: Dir }> };

export function createRelationView(ctx: GraphEditorContext, opts: OutlinerPaneOpts) {
  let focusId: string | null = opts.paneParentId ?? null;
  let lang: 'en' | 'ja' = opts.lang ?? ctx.state.lang;
  let selected: string | null = null;
  let relCache: Array<{ id: string; name?: string; color?: string }> | null = null;

  const el = document.createElement('div');
  el.style.cssText = `flex:1;overflow:auto;font-size:13px;`;

  const label = (n: ExplorerNode) => ((lang === 'en' ? (n.en || n.ja) : (n.ja || n.en)) || n.id);

  const render = (groups: RelGroup[]) => {
    el.innerHTML = '';
    if (focusId === null) {
      const hint = document.createElement('div');
      hint.textContent = 'ソースのノードを選択';
      hint.style.cssText = `padding:10px 12px;color:${TEXT_DIM};`;
      el.appendChild(hint);
      return;
    }
    for (const g of groups) {
      if (g.rows.length === 0) continue;
      const gh = document.createElement('div');
      gh.style.cssText = `display:flex;align-items:center;gap:7px;padding:7px 10px 3px;font-size:11px;color:${TEXT_MID};`;
      const tab = document.createElement('span');
      tab.style.cssText = `width:9px;height:9px;border-radius:2px;background:${g.color};flex:0 0 auto;`;
      gh.appendChild(tab);
      const nm = document.createElement('span');
      nm.textContent = g.name;
      nm.style.fontWeight = '600';
      gh.appendChild(nm);
      el.appendChild(gh);
      for (const row of g.rows) {
        const r = document.createElement('div');
        r.style.cssText = `display:flex;align-items:center;gap:8px;padding:3px 12px 3px 20px;cursor:pointer;color:${TEXT_HIGH};`;
        r.addEventListener('mouseenter', () => { r.style.background = 'rgba(255,255,255,.05)'; });
        r.addEventListener('mouseleave', () => { r.style.background = ''; });
        const dir = document.createElement('span');
        dir.textContent = row.dir;
        dir.style.cssText = `color:${TEXT_DIM};font-size:11px;width:12px;flex:0 0 auto;text-align:center;`;
        const dot = document.createElement('span');
        dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${g.color};flex:0 0 auto;`;
        const lb = document.createElement('span');
        lb.textContent = label(row.node);
        lb.style.cssText = `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
        r.append(dir, dot, lb);
        r.addEventListener('click', () => { selected = row.node.id; opts.onNodeSelect?.(row.node.id); });
        el.appendChild(r);
      }
    }
    if (!el.childElementCount) {
      const none = document.createElement('div');
      none.textContent = '(関係なし)';
      none.style.cssText = `padding:10px 12px;color:${TEXT_DIM};`;
      el.appendChild(none);
    }
  };

  const loadData = async () => {
    if (focusId === null) { render([]); return; }
    const fid = focusId;
    if (!relCache) relCache = await fetchRelations(ctx.gId);
    const relMeta = new Map(relCache.map((r) => [r.id, r]));
    const [children, nb] = await Promise.all([
      fetchChildren(ctx.gId, fid, ctx.limit),
      fetchNeighbors(ctx.gId, fid, 1),
    ]);
    if (focusId !== fid) return; // focus changed mid-fetch; a later loadData will render
    const nodeById = new Map(nb.nodes.map((n) => [n.id, n]));

    const groups: RelGroup[] = [];
    // 含有 = children (▼). Always present, independent of edge tagging.
    const cm = relMeta.get('containment');
    groups.push({
      name: cm?.name ?? '含有',
      color: cm?.color ?? '#2563EB',
      rows: children.map((n) => ({ node: n, dir: '▼' as Dir })),
    });

    // Other relations: lines incident to the focus, grouped by relation_id.
    const byRel = new Map<string, RelGroup>();
    for (const e of nb.edges) {
      if (!e.relation_id || e.relation_id === 'containment') continue;
      if (e.a !== fid && e.b !== fid) continue;
      const otherId = e.a === fid ? e.b : e.a;
      const other = nodeById.get(otherId);
      if (!other) continue;
      const dir: Dir = !e.source ? '—' : (e.source === fid ? '→' : '←');
      let g = byRel.get(e.relation_id);
      if (!g) {
        const m = relMeta.get(e.relation_id);
        g = { name: m?.name ?? e.relation_id, color: m?.color ?? '#888', rows: [] };
        byRel.set(e.relation_id, g);
      }
      g.rows.push({ node: other, dir });
    }
    // Append in palette order (stable, predictable).
    for (const r of relCache) {
      const g = byRel.get(r.id);
      if (g) groups.push(g);
    }
    render(groups);
  };

  const setFocus = async (id: string | null) => { focusId = id; await loadData(); };

  // Outliner-shaped surface so the multi-pane hosts this like any pane. Real behaviour on the
  // members it uses for relation browsing; the rest (editing / reordering) are inert no-ops.
  return {
    el,
    load: () => loadData(),
    refresh: () => { void loadData(); },
    search: async () => { /* relation view has no in-pane search */ },
    setParent: (nodeId: string | null) => setFocus(nodeId),
    getAncestorIds: () => new Set<string>(),
    getNodePath: () => [] as PathEntry[],
    getSelectedId: () => selected ?? focusId,
    getPaneParentId: () => focusId,
    getEffectiveParentId: () => null,
    getNodeParentId: () => undefined,
    setPaneFilterKeys: () => { /* no filtering in relation view */ },
    setPaneSortByProps: () => { /* no sort in relation view */ },
    setLang: (l: 'en' | 'ja') => { lang = l; void loadData(); },
    setSourceRoot: async () => { await setFocus(null); },
    applyPropertySort: async () => { /* not applicable */ },
    beginKeyMove: () => false,
    acceptKeyMove: async () => { /* not applicable */ },
    openKeyMenu: () => { /* no key menu in relation view */ },
    unregister: () => { /* no hooks registered */ },
  };
}
