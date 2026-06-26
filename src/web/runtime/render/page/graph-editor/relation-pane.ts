import type { ExplorerNode, GraphEditorContext } from './types';
import type { OutlinerPaneOpts, PathEntry } from './outliner-view';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, primaryLabel, fallbackLabel } from './constants';
import { fetchChildren, fetchNeighbors, fetchRelations, apiSetLine } from './api';

// Column C of "ノード | 関係 | 紐づくノード": one pane shows ONE relation of a focus node, as a flat
// list of the linked nodes. 含有 (relationFilter='containment') = the node's children; other relations
// = its lines with that relation_id (direction → outgoing / ← incoming / — undirected). Each row's ▾
// reassigns that line's relation. Chrome (breadcrumb, square marker, label font, language) matches the
// outliner pane. Outliner-shaped so the multi-pane hosts it without special casing (caller casts).

type Dir = '▼' | '→' | '←' | '—';

export function createRelationView(ctx: GraphEditorContext, opts: OutlinerPaneOpts) {
  let focusId: string | null = opts.paneParentId ?? null;
  let lang: 'en' | 'ja' = opts.lang ?? ctx.state.lang;
  let relationFilter: string = opts.relationFilter ?? 'containment';
  let selected: string | null = null;
  let path: PathEntry[] = opts.panePath ?? [];
  let relCache: Array<{ id: string; name?: string; color?: string }> | null = null;

  const el = document.createElement('div');
  el.style.cssText = `flex:1;display:flex;flex-direction:column;overflow:hidden;`;
  const bcEl = document.createElement('div');
  bcEl.style.cssText = `display:flex;flex-shrink:0;align-items:center;gap:2px;flex-wrap:wrap;padding:4px 8px 4px 10px;border-bottom:1px solid ${BORDER};font-size:12px;`;
  const bodyEl = document.createElement('div');
  bodyEl.style.cssText = `flex:1;overflow:auto;`;
  el.append(bcEl, bodyEl);

  const labelOf = (n: ExplorerNode) => primaryLabel(n, lang) ?? fallbackLabel(n, lang) ?? n.id.slice(0, 8);

  const renderBreadcrumb = () => {
    bcEl.innerHTML = '';
    if (path.length === 0) {
      const s = document.createElement('span');
      s.textContent = 'ルート';
      s.style.cssText = `color:${TEXT_HIGH};font-size:12px;padding:0 2px;`;
      bcEl.appendChild(s);
      return;
    }
    path.forEach((e, i) => {
      if (i > 0) { const sep = document.createElement('span'); sep.textContent = ' › '; sep.style.color = TEXT_DIM; bcEl.appendChild(sep); }
      const span = document.createElement('span');
      span.textContent = e.label;
      span.title = e.label;
      span.style.cssText = `color:${i === path.length - 1 ? TEXT_HIGH : TEXT_MID};font-size:12px;padding:0 2px;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;`;
      bcEl.appendChild(span);
    });
  };

  const hint = (text: string) => {
    const h = document.createElement('div');
    h.textContent = text;
    h.style.cssText = `padding:8px 12px;color:${TEXT_DIM};font-size:13px;`;
    bodyEl.appendChild(h);
  };

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
        await apiSetLine(ctx.gId, fid, targetId, relId === null ? { relation_id: null, source: null } : { relation_id: relId, source: fid });
        await loadData();
      });
      menu.appendChild(it);
    };
    item('関係なし（含有）', null, currentRelId === null);
    for (const r of relCache ?? []) { if (r.id === 'containment') continue; item(r.name ?? r.id, r.id, currentRelId === r.id); }
    document.body.appendChild(menu);
    const onOut = (e: MouseEvent) => { if (openMenu && !openMenu.contains(e.target as Node)) { closeMenu(); document.removeEventListener('mousedown', onOut); } };
    setTimeout(() => document.addEventListener('mousedown', onOut), 0);
  };

  const renderRows = (rows: Array<{ node: ExplorerNode; dir: Dir }>, relColor: string) => {
    bodyEl.innerHTML = '';
    if (focusId === null) { hint('ソースのノードを選択'); return; }
    if (rows.length === 0) { hint('（なし）'); return; }
    const curRel = relationFilter === 'containment' ? null : relationFilter;
    for (const r of rows) {
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;padding:0 6px;cursor:pointer;min-height:24px;`;
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,.05)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      const mw = document.createElement('span');
      mw.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;`;
      const sq = document.createElement('span');
      sq.style.cssText = `width:7px;height:7px;border-radius:1px;background:${r.node.color ?? relColor};`;
      mw.appendChild(sq);
      const dir = document.createElement('span');
      dir.textContent = r.dir;
      dir.style.cssText = `color:${TEXT_DIM};font-size:11px;width:12px;flex:0 0 auto;text-align:center;`;
      const lb = document.createElement('span');
      lb.textContent = labelOf(r.node);
      lb.style.cssText = `flex:1;min-width:0;font-size:14px;line-height:1.5;padding:0 4px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${r.node.color ?? TEXT_HIGH};`;
      const edit = document.createElement('span');
      edit.textContent = '▾';
      edit.title = '関係を設定';
      edit.style.cssText = `color:${TEXT_DIM};cursor:pointer;font-size:12px;padding:0 4px;flex:0 0 auto;`;
      const tid = r.node.id;
      edit.addEventListener('click', (ev) => { ev.stopPropagation(); openRelMenu(edit, tid, curRel); });
      row.append(mw, dir, lb, edit);
      row.addEventListener('click', () => { selected = r.node.id; opts.onNodeSelect?.(r.node.id); });
      bodyEl.appendChild(row);
    }
  };

  const loadData = async () => {
    renderBreadcrumb();
    if (!relCache) relCache = await fetchRelations(ctx.gId);
    const meta = relCache.find((r) => r.id === relationFilter);
    const isContain = relationFilter === 'containment';
    const relColor = meta?.color ?? (isContain ? '#2563EB' : '#888888');
    if (focusId === null) { renderRows([], relColor); return; }
    const fid = focusId;

    if (isContain) {
      const [children, nb] = await Promise.all([fetchChildren(ctx.gId, fid, ctx.limit), fetchNeighbors(ctx.gId, fid, 1)]);
      if (focusId !== fid) return;
      const taggedIds = new Set<string>();
      for (const e of nb.edges) {
        if (e.relation_id && e.relation_id !== 'containment' && (e.a === fid || e.b === fid)) taggedIds.add(e.a === fid ? e.b : e.a);
      }
      renderRows(children.filter((n) => !taggedIds.has(n.id)).map((n) => ({ node: n, dir: '▼' as Dir })), relColor);
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
    renderRows(rows, relColor);
  };

  return {
    el,
    load: () => loadData(),
    refresh: () => { void loadData(); },
    search: async () => { /* n/a */ },
    setParent: (nodeId: string | null, _excl?: Set<string>, p?: PathEntry[]) => { focusId = nodeId; if (p) path = p; return loadData(); },
    setRelation: async (relId: string) => { relationFilter = relId; await loadData(); },
    setFocusRelation: async (id: string | null, rel: string, p?: PathEntry[]) => { focusId = id; relationFilter = rel; if (p) path = p; await loadData(); },
    getRelation: () => relationFilter,
    getAncestorIds: () => new Set<string>(),
    getNodePath: () => path,
    getSelectedId: () => selected ?? focusId,
    getPaneParentId: () => focusId,
    getEffectiveParentId: () => null,
    getNodeParentId: () => undefined,
    setPaneFilterKeys: () => { /* n/a */ },
    setPaneSortByProps: () => { /* n/a */ },
    setLang: (l: 'en' | 'ja') => { lang = l; void loadData(); },
    setSourceRoot: async () => { focusId = null; path = []; await loadData(); },
    applyPropertySort: async () => { /* n/a */ },
    beginKeyMove: () => false,
    acceptKeyMove: async () => { /* n/a */ },
    openKeyMenu: () => { /* n/a */ },
    unregister: () => { closeMenu(); },
  };
}
