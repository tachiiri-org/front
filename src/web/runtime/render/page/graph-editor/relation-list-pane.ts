import type { GraphEditorContext } from './types';
import type { OutlinerPaneOpts, PathEntry } from './outliner-view';
import { TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG } from './constants';
import { fetchChildren, fetchNeighbors, fetchRelations } from './api';

// Column B of the "ノード | 関係 | 紐づくノード" layout: lists the relations the focus node
// participates in (含有 = its children, plus any relation present on its lines), as selectable rows.
// Selecting a relation propagates (via onNodeSelect of the focus node) so the dependent objects pane
// (column C, a relation view) shows that relation's nodes — the multi-pane reads getSelectedRelation().
//
// Outliner-shaped so the multi-pane hosts it without special casing (caller casts); editing methods
// are inert. getSelectedRelation() is the one extra, read by the multi-pane wiring.

type RelItem = { relId: string; name: string; color: string; count: number };

export function createRelationListView(ctx: GraphEditorContext, opts: OutlinerPaneOpts) {
  let focusId: string | null = opts.paneParentId ?? null;
  let selectedRelation = 'containment';
  let relCache: Array<{ id: string; name?: string; color?: string }> | null = null;
  let items: RelItem[] = [];

  const el = document.createElement('div');
  el.style.cssText = `flex:1;overflow:auto;font-size:13px;`;

  const render = () => {
    el.innerHTML = '';
    if (focusId === null) {
      const hint = document.createElement('div');
      hint.textContent = 'ソースのノードを選択';
      hint.style.cssText = `padding:10px 12px;color:${TEXT_DIM};`;
      el.appendChild(hint);
      return;
    }
    for (const it of items) {
      const row = document.createElement('div');
      const active = it.relId === selectedRelation;
      row.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 12px;cursor:pointer;color:${active ? TEXT_HIGH : TEXT_MID};background:${active ? SELECT_STRONG : 'transparent'};`;
      row.addEventListener('mouseenter', () => { if (!active) row.style.background = 'rgba(255,255,255,.05)'; });
      row.addEventListener('mouseleave', () => { if (!active) row.style.background = 'transparent'; });
      const tab = document.createElement('span');
      tab.style.cssText = `width:10px;height:10px;border-radius:3px;background:${it.color};flex:0 0 auto;`;
      const nm = document.createElement('span');
      nm.textContent = it.name;
      nm.style.cssText = `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;`;
      const cnt = document.createElement('span');
      cnt.textContent = String(it.count);
      cnt.style.cssText = `color:${TEXT_DIM};font-size:11px;flex:0 0 auto;`;
      row.append(tab, nm, cnt);
      row.addEventListener('click', () => {
        selectedRelation = it.relId;
        render();
        if (focusId !== null) opts.onNodeSelect?.(focusId); // propagate focus; relation read via getSelectedRelation
      });
      el.appendChild(row);
    }
  };

  const loadData = async () => {
    if (focusId === null) { items = []; render(); return; }
    const fid = focusId;
    if (!relCache) relCache = await fetchRelations(ctx.gId);
    const relMeta = new Map(relCache.map((r) => [r.id, r]));
    const [children, nb] = await Promise.all([
      fetchChildren(ctx.gId, fid, ctx.limit),
      fetchNeighbors(ctx.gId, fid, 1),
    ]);
    if (focusId !== fid) return;
    const taggedIds = new Set<string>();
    const relCount = new Map<string, number>();
    for (const e of nb.edges) {
      if (e.relation_id && e.relation_id !== 'containment' && (e.a === fid || e.b === fid)) {
        taggedIds.add(e.a === fid ? e.b : e.a);
        relCount.set(e.relation_id, (relCount.get(e.relation_id) ?? 0) + 1);
      }
    }
    const containCount = children.filter((n) => !taggedIds.has(n.id)).length;
    const cm = relMeta.get('containment');
    const next: RelItem[] = [{ relId: 'containment', name: cm?.name ?? '含有', color: cm?.color ?? '#2563EB', count: containCount }];
    for (const r of relCache) {
      if (r.id === 'containment') continue;
      const c = relCount.get(r.id);
      if (c) next.push({ relId: r.id, name: r.name ?? r.id, color: r.color ?? '#888888', count: c });
    }
    items = next;
    if (!items.some((i) => i.relId === selectedRelation)) selectedRelation = items[0]?.relId ?? 'containment';
    render();
  };

  const setFocus = async (id: string | null) => {
    focusId = id;
    await loadData();
    if (focusId !== null) opts.onNodeSelect?.(focusId); // keep the objects pane (C) in sync with A's node
  };

  return {
    el,
    load: () => loadData(),
    refresh: () => { void loadData(); },
    search: async () => { /* n/a */ },
    setParent: (nodeId: string | null) => setFocus(nodeId),
    getSelectedRelation: () => selectedRelation,
    getAncestorIds: () => new Set<string>(),
    getNodePath: () => [] as PathEntry[],
    getSelectedId: () => focusId,
    getPaneParentId: () => focusId,
    getEffectiveParentId: () => null,
    getNodeParentId: () => undefined,
    setPaneFilterKeys: () => { /* n/a */ },
    setPaneSortByProps: () => { /* n/a */ },
    setLang: () => { /* relation names are language-neutral here */ },
    setSourceRoot: async () => { await setFocus(null); },
    applyPropertySort: async () => { /* n/a */ },
    beginKeyMove: () => false,
    acceptKeyMove: async () => { /* n/a */ },
    openKeyMenu: () => { /* n/a */ },
    unregister: () => { /* no hooks */ },
  };
}
