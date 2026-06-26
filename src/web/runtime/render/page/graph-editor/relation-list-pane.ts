import type { GraphEditorContext } from './types';
import type { OutlinerPaneOpts, PathEntry } from './outliner-view';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG } from './constants';
import { fetchChildren, fetchNeighbors, fetchRelations } from './api';

// Column B of "ノード | 関係 | 紐づくノード": lists the relations the focus node participates in
// (含有 = its children, plus relations present on its lines), with counts, as selectable rows.
// Selecting a relation propagates (onNodeSelect of the focus) so the dependent objects pane (column C)
// shows that relation's nodes — the multi-pane reads getSelectedRelation(). Chrome (breadcrumb, square
// marker, label font) matches the outliner. Outliner-shaped so the multi-pane hosts it (caller casts).

type RelItem = { relId: string; name: string; color: string; count: number };

export function createRelationListView(ctx: GraphEditorContext, opts: OutlinerPaneOpts) {
  let focusId: string | null = opts.paneParentId ?? null;
  let selectedRelation = 'containment';
  let path: PathEntry[] = opts.panePath ?? [];
  let relCache: Array<{ id: string; name?: string; color?: string }> | null = null;
  let items: RelItem[] = [];

  const el = document.createElement('div');
  el.style.cssText = `flex:1;display:flex;flex-direction:column;overflow:hidden;`;
  const bcEl = document.createElement('div');
  bcEl.style.cssText = `display:flex;flex-shrink:0;align-items:center;gap:2px;flex-wrap:wrap;padding:4px 8px 4px 10px;border-bottom:1px solid ${BORDER};font-size:12px;`;
  const bodyEl = document.createElement('div');
  bodyEl.style.cssText = `flex:1;overflow:auto;`;
  el.append(bcEl, bodyEl);

  // Keep the header row (height parity with the outliner) but show no path text.
  const renderBreadcrumb = () => {
    bcEl.innerHTML = '';
    const spacer = document.createElement('span');
    spacer.innerHTML = '&nbsp;';
    spacer.style.cssText = `font-size:12px;`;
    bcEl.appendChild(spacer);
  };

  const render = () => {
    renderBreadcrumb();
    bodyEl.innerHTML = '';
    if (focusId === null) {
      const h = document.createElement('div');
      h.textContent = 'ソースのノードを選択';
      h.style.cssText = `padding:8px 12px;color:${TEXT_DIM};font-size:13px;`;
      bodyEl.appendChild(h);
      return;
    }
    for (const it of items) {
      const row = document.createElement('div');
      const active = it.relId === selectedRelation;
      row.style.cssText = `display:flex;align-items:center;padding:0 6px;cursor:pointer;min-height:24px;background:${active ? SELECT_STRONG : 'transparent'};`;
      row.addEventListener('mouseenter', () => { if (!active) row.style.background = 'rgba(255,255,255,.05)'; });
      row.addEventListener('mouseleave', () => { if (!active) row.style.background = 'transparent'; });
      const mw = document.createElement('span');
      mw.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;`;
      const sq = document.createElement('span');
      sq.style.cssText = `width:7px;height:7px;border-radius:1px;background:${it.color};`;
      mw.appendChild(sq);
      const nm = document.createElement('span');
      nm.textContent = it.name;
      nm.style.cssText = `flex:1;min-width:0;font-size:14px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${active ? TEXT_HIGH : TEXT_MID};`;
      const cnt = document.createElement('span');
      cnt.textContent = String(it.count);
      cnt.style.cssText = `color:${TEXT_DIM};font-size:11px;flex:0 0 auto;padding:0 6px 0 4px;`;
      row.append(mw, nm, cnt);
      row.addEventListener('click', () => {
        selectedRelation = it.relId;
        render();
        if (focusId !== null) opts.onNodeSelect?.(focusId);
      });
      bodyEl.appendChild(row);
    }
  };

  const loadData = async () => {
    if (focusId === null) { items = []; render(); return; }
    const fid = focusId;
    if (!relCache) relCache = await fetchRelations(ctx.gId);
    const relMeta = new Map(relCache.map((r) => [r.id, r]));
    const [children, nb] = await Promise.all([fetchChildren(ctx.gId, fid, ctx.limit), fetchNeighbors(ctx.gId, fid, 1)]);
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

  const setFocus = async (id: string | null, p?: PathEntry[]) => {
    focusId = id;
    if (p) path = p;
    await loadData();
    if (focusId !== null) opts.onNodeSelect?.(focusId); // keep column C in sync with column A's node
  };

  return {
    el,
    load: () => loadData(),
    refresh: () => { void loadData(); },
    search: async () => { /* n/a */ },
    setParent: (nodeId: string | null, _excl?: Set<string>, p?: PathEntry[]) => setFocus(nodeId, p),
    getSelectedRelation: () => selectedRelation,
    getAncestorIds: () => new Set<string>(),
    getNodePath: () => path,
    getSelectedId: () => focusId,
    getPaneParentId: () => focusId,
    getEffectiveParentId: () => null,
    getNodeParentId: () => undefined,
    setPaneFilterKeys: () => { /* n/a */ },
    setPaneSortByProps: () => { /* n/a */ },
    setLang: () => { render(); },
    setSourceRoot: async () => { await setFocus(null); },
    applyPropertySort: async () => { /* n/a */ },
    beginKeyMove: () => false,
    acceptKeyMove: async () => { /* n/a */ },
    openKeyMenu: () => { /* n/a */ },
    unregister: () => { /* no hooks */ },
  };
}
