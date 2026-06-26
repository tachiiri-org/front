import type { ExplorerNode, GraphEditorContext } from './types';
import type { OutlinerPaneOpts, PathEntry } from './outliner-view';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM } from './constants';
import { fetchChildren, fetchNeighbors, fetchRelations, apiSetLine } from './api';

// Read-only/relabel "relation" view: one pane shows ONE relation of a focus node, as a flat list.
// 含有 (relationFilter='containment') = the node's children (existing /children endpoint; works on
// untyped legacy edges, no relabel needed). Other relations = the focus node's lines carrying that
// relation_id, from the neighbors+edges API, with direction (→ outgoing / ← incoming / — undirected).
// Each row's ▾ reassigns that line's relation. To see several relations at once, use several panes —
// each is an independent column.
//
// Deliberately NOT built on the outliner (its children-cache is keyed by node id and tied to
// containment editing); returned shaped like the outliner so the multi-pane hosts it without special
// casing (caller casts), with unused outliner methods inert.

type Dir = '▼' | '→' | '←' | '—';

export function createRelationView(ctx: GraphEditorContext, opts: OutlinerPaneOpts) {
  let focusId: string | null = opts.paneParentId ?? null;
  let lang: 'en' | 'ja' = opts.lang ?? ctx.state.lang;
  let relationFilter: string = opts.relationFilter ?? 'containment';
  let selected: string | null = null;
  let relCache: Array<{ id: string; name?: string; color?: string }> | null = null;

  const el = document.createElement('div');
  el.style.cssText = `flex:1;overflow:auto;font-size:13px;`;

  const label = (n: ExplorerNode) => ((lang === 'en' ? (n.en || n.ja) : (n.ja || n.en)) || n.id);

  // Per-row relation editor: pick a relation (directed from the focus) or 含有 to clear it.
  let openMenu: HTMLElement | null = null;
  const closeMenu = () => { openMenu?.remove(); openMenu = null; };
  const openRelMenu = (anchor: HTMLElement, targetId: string, currentRelId: string | null) => {
    closeMenu();
    if (focusId === null) return;
    const fid = focusId;
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    openMenu = menu;
    menu.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.bottom + 2}px;z-index:300;background:hsl(240,14%,9%);border:1px solid ${BORDER};border-radius:6px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,.4);min-width:140px;`;
    const item = (text: string, relId: string | null, active: boolean) => {
      const it = document.createElement('div');
      it.textContent = (active ? '✓ ' : '') + text;
      it.style.cssText = `padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;color:${active ? TEXT_HIGH : TEXT_MID};white-space:nowrap;`;
      it.addEventListener('mouseenter', () => { it.style.background = 'rgba(255,255,255,.07)'; });
      it.addEventListener('mouseleave', () => { it.style.background = ''; });
      it.addEventListener('click', async () => {
        closeMenu();
        await apiSetLine(ctx.gId, fid, targetId, relId === null
          ? { relation_id: null, source: null }
          : { relation_id: relId, source: fid });
        await loadData();
      });
      menu.appendChild(it);
    };
    item('関係なし（含有）', null, currentRelId === null);
    for (const r of relCache ?? []) {
      if (r.id === 'containment') continue;
      item(r.name ?? r.id, r.id, currentRelId === r.id);
    }
    document.body.appendChild(menu);
    const onOut = (e: MouseEvent) => {
      if (openMenu && !openMenu.contains(e.target as Node)) { closeMenu(); document.removeEventListener('mousedown', onOut); }
    };
    setTimeout(() => document.addEventListener('mousedown', onOut), 0);
  };

  const render = (rows: Array<{ node: ExplorerNode; dir: Dir }>, relName: string, relColor: string) => {
    el.innerHTML = '';
    // Which relation a row currently carries (for the ▾ editor): null for the 含有 pane.
    const curRel = relationFilter === 'containment' ? null : relationFilter;
    // Small in-body header naming the relation this pane shows.
    const head = document.createElement('div');
    head.style.cssText = `display:flex;align-items:center;gap:7px;padding:7px 10px 5px;font-size:11px;color:${TEXT_MID};border-bottom:1px solid rgba(255,255,255,.05);`;
    const tab = document.createElement('span');
    tab.style.cssText = `width:9px;height:9px;border-radius:2px;background:${relColor};flex:0 0 auto;`;
    const nm = document.createElement('span');
    nm.textContent = relName;
    nm.style.fontWeight = '600';
    head.append(tab, nm);
    el.appendChild(head);

    if (focusId === null) {
      const hint = document.createElement('div');
      hint.textContent = 'ソースのノードを選択';
      hint.style.cssText = `padding:10px 12px;color:${TEXT_DIM};`;
      el.appendChild(hint);
      return;
    }
    if (rows.length === 0) {
      const none = document.createElement('div');
      none.textContent = '（なし）';
      none.style.cssText = `padding:10px 12px;color:${TEXT_DIM};`;
      el.appendChild(none);
      return;
    }
    for (const row of rows) {
      const r = document.createElement('div');
      r.style.cssText = `display:flex;align-items:center;gap:8px;padding:3px 12px;cursor:pointer;color:${TEXT_HIGH};`;
      r.addEventListener('mouseenter', () => { r.style.background = 'rgba(255,255,255,.05)'; });
      r.addEventListener('mouseleave', () => { r.style.background = ''; });
      const dir = document.createElement('span');
      dir.textContent = row.dir;
      dir.style.cssText = `color:${TEXT_DIM};font-size:11px;width:12px;flex:0 0 auto;text-align:center;`;
      const dot = document.createElement('span');
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${relColor};flex:0 0 auto;`;
      const lb = document.createElement('span');
      lb.textContent = label(row.node);
      lb.style.cssText = `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
      const edit = document.createElement('span');
      edit.textContent = '▾';
      edit.title = '関係を設定';
      edit.style.cssText = `color:${TEXT_DIM};cursor:pointer;font-size:12px;padding:0 4px;flex:0 0 auto;`;
      const targetId = row.node.id;
      edit.addEventListener('click', (ev) => { ev.stopPropagation(); openRelMenu(edit, targetId, curRel); });
      r.append(dir, dot, lb, edit);
      r.addEventListener('click', () => { selected = row.node.id; opts.onNodeSelect?.(row.node.id); });
      el.appendChild(r);
    }
  };

  const loadData = async () => {
    if (!relCache) relCache = await fetchRelations(ctx.gId);
    const meta = relCache.find((r) => r.id === relationFilter);
    const isContain = relationFilter === 'containment';
    const relName = meta?.name ?? (isContain ? '含有' : relationFilter);
    const relColor = meta?.color ?? (isContain ? '#2563EB' : '#888888');
    if (focusId === null) { render([], relName, relColor); return; }
    const fid = focusId;

    if (isContain) {
      const [children, nb] = await Promise.all([
        fetchChildren(ctx.gId, fid, ctx.limit),
        fetchNeighbors(ctx.gId, fid, 1),
      ]);
      if (focusId !== fid) return;
      // A child reached by a *tagged* (non-containment) line belongs to that relation, not 含有.
      const taggedIds = new Set<string>();
      for (const e of nb.edges) {
        if (e.relation_id && e.relation_id !== 'containment' && (e.a === fid || e.b === fid)) {
          taggedIds.add(e.a === fid ? e.b : e.a);
        }
      }
      const rows = children.filter((n) => !taggedIds.has(n.id)).map((n) => ({ node: n, dir: '▼' as Dir }));
      render(rows, relName, relColor);
      return;
    }

    const nb = await fetchNeighbors(ctx.gId, fid, 1);
    if (focusId !== fid) return;
    const nodeById = new Map(nb.nodes.map((n) => [n.id, n]));
    const rows: Array<{ node: ExplorerNode; dir: Dir }> = [];
    for (const e of nb.edges) {
      if (e.relation_id !== relationFilter) continue;
      if (e.a !== fid && e.b !== fid) continue;
      const other = nodeById.get(e.a === fid ? e.b : e.a);
      if (!other) continue;
      rows.push({ node: other, dir: !e.source ? '—' : (e.source === fid ? '→' : '←') });
    }
    render(rows, relName, relColor);
  };

  const setFocus = async (id: string | null) => { focusId = id; await loadData(); };
  const setRelation = async (relId: string) => { relationFilter = relId; await loadData(); };

  // Outliner-shaped surface so the multi-pane hosts this like any pane; extras (setRelation/
  // getRelation) are read via the captured relation-view reference in createPane.
  return {
    el,
    load: () => loadData(),
    refresh: () => { void loadData(); },
    search: async () => { /* no in-pane search */ },
    setParent: (nodeId: string | null) => setFocus(nodeId),
    setRelation,
    // Set focus + relation together in one load (used when driven by a relation-list pane).
    setFocusRelation: async (id: string | null, rel: string) => { focusId = id; relationFilter = rel; await loadData(); },
    getRelation: () => relationFilter,
    getAncestorIds: () => new Set<string>(),
    getNodePath: () => [] as PathEntry[],
    getSelectedId: () => selected ?? focusId,
    getPaneParentId: () => focusId,
    getEffectiveParentId: () => null,
    getNodeParentId: () => undefined,
    setPaneFilterKeys: () => { /* n/a */ },
    setPaneSortByProps: () => { /* n/a */ },
    setLang: (l: 'en' | 'ja') => { lang = l; void loadData(); },
    setSourceRoot: async () => { await setFocus(null); },
    applyPropertySort: async () => { /* n/a */ },
    beginKeyMove: () => false,
    acceptKeyMove: async () => { /* n/a */ },
    openKeyMenu: () => { /* n/a */ },
    unregister: () => { closeMenu(); },
  };
}
