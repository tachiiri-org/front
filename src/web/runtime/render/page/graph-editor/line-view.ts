import type { GraphEditorContext, PaneView, ExplorerNode, ExplorerLine, PaneViewPathEntry } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG } from './constants';
import {
  fetchNodeLines, apiCreateRelation, apiSetLineBody, apiAddRay, fetchAllNodes, apiCreateNode,
} from './api';

// 関係 (line) パネル。左で選んだノードの関係を素のテキスト行として読み書きする。
// - 本文はノードラベルと同じく素のテキスト入力（ポップアップ無し）。
// - 本文中で「@」を押すとノード検索が出て、選ぶとラベルを挿入＋参加者として紐付け(j_ray)。
// - 関係にフォーカスするとその関係が「アクティブ」になり、ノードパネルの四角が
//   塗り(参加)/空(非参加) を表す。四角の右クリックで link/unlink（outliner 側）。

function labelOf(n: ExplorerNode, lang: 'en' | 'ja'): string {
  const primary = lang === 'ja' ? n.ja : n.en;
  const fallback = lang === 'ja' ? n.en : n.ja;
  return primary || fallback || n.id;
}

export function createLineView(
  ctx: GraphEditorContext,
  opts: { lang: 'en' | 'ja'; initialNodeId?: string | null },
): PaneView {
  let lang = opts.lang;
  let currentNodeId: string | null = opts.initialNodeId ?? null;
  let renderToken = 0;
  // lineId → その行の textarea（アクティブ強調の付け替え用）。
  const taByLine = new Map<string, HTMLTextAreaElement>();

  const el = document.createElement('div');
  el.style.cssText = `flex:1;display:flex;flex-direction:column;overflow:hidden;`;

  const head = document.createElement('div');
  head.style.cssText = `flex-shrink:0;height:28px;box-sizing:border-box;padding:0 8px;border-bottom:1px solid ${BORDER};font-size:11px;color:${TEXT_MID};display:flex;align-items:center;gap:6px;`;
  el.appendChild(head);

  const bodyEl = document.createElement('div');
  bodyEl.style.cssText = `flex:1;overflow-y:auto;padding:6px 8px;`;
  el.appendChild(bodyEl);

  // ── @メンション用ドロップダウン（1つを使い回す） ──────────────────────────────
  const menu = document.createElement('div');
  menu.style.cssText = `position:fixed;z-index:300;background:hsl(240,14%,9%);border:1px solid ${BORDER};border-radius:6px;max-height:200px;overflow-y:auto;min-width:180px;display:none;box-shadow:0 4px 12px rgba(0,0,0,.4);`;
  document.body.appendChild(menu);
  let mention: { ta: HTMLTextAreaElement; lineId: string; atStart: number; end: number } | null = null;
  const closeMenu = () => { menu.style.display = 'none'; menu.innerHTML = ''; mention = null; };

  const setActive = (line: ExplorerLine) => {
    const cur = ctx.activeRelation;
    // Re-focusing the already-active relation keeps its live participant set (which may include
    // additions made by right-clicking node squares since this row was rendered).
    if (!cur || cur.lineId !== line.lineId) {
      ctx.setActiveRelation({ lineId: line.lineId, participants: new Set(line.participants.map((p) => p.id)) });
    }
    updateActiveHighlight();
  };
  const updateActiveHighlight = () => {
    const activeId = ctx.activeRelation?.lineId ?? null;
    for (const [lid, ta] of taByLine) {
      ta.style.borderLeft = `2px solid ${lid === activeId ? SELECT_STRONG : 'transparent'}`;
    }
  };

  // メンション挿入: 「@query」を選んだノードのラベルに置換し、参加者に紐付け＋本文保存。
  const insertMention = async (n: ExplorerNode, createLabel?: string) => {
    if (!mention) return;
    const { ta, lineId, atStart, end } = mention;
    let nodeId = n.id;
    if (createLabel) {
      const created = await apiCreateNode(ctx.gId, null, lang, createLabel);
      if (!created) { closeMenu(); return; }
      nodeId = created.id;
    }
    const label = createLabel ?? labelOf(n, lang);
    ta.value = ta.value.slice(0, atStart) + label + ta.value.slice(end);
    const caret = atStart + label.length;
    closeMenu();
    ta.focus();
    ta.setSelectionRange(caret, caret);
    ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
    await apiAddRay(ctx.gId, lineId, nodeId);
    const ar = ctx.activeRelation;
    if (ar && ar.lineId === lineId) { ar.participants.add(nodeId); ctx.setActiveRelation(ar); }
    await apiSetLineBody(ctx.gId, lineId, lang, ta.value);
  };

  const showMenu = (ta: HTMLTextAreaElement, query: string, nodes: ExplorerNode[]) => {
    menu.innerHTML = '';
    const rows: Array<{ label: string; act: () => void }> = nodes.slice(0, 20).map((n) => ({
      label: labelOf(n, lang), act: () => void insertMention(n),
    }));
    const exact = nodes.find((n) => labelOf(n, lang) === query);
    if (query && !exact) rows.push({ label: `＋「${query}」を新規ノードで作成して挿入`, act: () => void insertMention({ id: '' }, query) });
    if (rows.length === 0) { closeMenu(); return; }
    for (const r of rows) {
      const item = document.createElement('div');
      item.textContent = r.label;
      item.style.cssText = `padding:4px 8px;cursor:pointer;color:${TEXT_MID};font-size:12px;white-space:nowrap;`;
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,.07)'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
      item.addEventListener('mousedown', (e) => { e.preventDefault(); r.act(); });
      menu.appendChild(item);
    }
    const rect = ta.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 2}px`;
    menu.style.display = 'block';
  };

  // 本文の input ごとに「@…」を検出してドロップダウンを出す。
  const handleMention = async (ta: HTMLTextAreaElement, lineId: string) => {
    const caret = ta.selectionStart;
    const before = ta.value.slice(0, caret);
    const m = before.match(/@([^\s@]*)$/);
    if (!m) { closeMenu(); return; }
    const q = m[1];
    mention = { ta, lineId, atStart: caret - m[0].length, end: caret };
    const seq = ++mentionSeq;
    const { nodes } = await fetchAllNodes(ctx.gId, [], 0, lang, undefined, q || undefined);
    if (seq !== mentionSeq || !mention) return;
    showMenu(ta, q, nodes);
  };
  let mentionSeq = 0;

  // ── 関係 1 件 = 素のテキスト行 ───────────────────────────────────────────────
  const renderRelationRow = (line: ExplorerLine): HTMLElement => {
    const row = document.createElement('div');
    row.style.cssText = `padding:2px 0;`;
    const ta = document.createElement('textarea');
    ta.value = line.body[lang] ?? line.body[lang === 'ja' ? 'en' : 'ja'] ?? '';
    ta.placeholder = '関係をテキストで（@ でノードを挿入・紐付け）';
    ta.rows = 1;
    ta.style.cssText = `width:100%;box-sizing:border-box;background:transparent;border:none;border-left:2px solid transparent;outline:none;resize:none;font-size:14px;font-family:inherit;line-height:1.5;padding:0 4px;overflow:hidden;color:${TEXT_HIGH};`;
    taByLine.set(line.lineId, ta);
    const resize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    setTimeout(resize, 0);
    ta.addEventListener('focus', () => setActive(line));
    ta.addEventListener('input', () => { resize(); void handleMention(ta, line.lineId); });
    ta.addEventListener('blur', () => { void apiSetLineBody(ctx.gId, line.lineId, lang, ta.value); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    row.appendChild(ta);
    return row;
  };

  // ノードパネルの draft 行に倣った □「関係を追加」行。
  const makeAddRow = (nodeId: string): HTMLElement => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;padding:2px 0;cursor:pointer;`;
    const sp = document.createElement('span'); sp.style.cssText = `flex-shrink:0;width:6px;`;
    const bw = document.createElement('span'); bw.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;`;
    const sq = document.createElement('span'); sq.style.cssText = `width:7px;height:7px;border-radius:1px;box-sizing:border-box;background:transparent;border:1.5px solid ${TEXT_DIM};`;
    bw.appendChild(sq); row.append(sp, bw);
    row.addEventListener('click', async () => { await apiCreateRelation(ctx.gId, nodeId, lang, ''); await render(); });
    return row;
  };

  // ── 列全体の描画 ─────────────────────────────────────────────────────────────
  const render = async (): Promise<void> => {
    const token = ++renderToken;
    head.innerHTML = '';
    bodyEl.innerHTML = '';
    taByLine.clear();
    if (!currentNodeId) return;
    const nodeId = currentNodeId;

    const title = document.createElement('span');
    title.textContent = '関係';
    title.style.cssText = `color:${TEXT_HIGH};font-size:12px;`;
    head.appendChild(title);

    const lines = await fetchNodeLines(ctx.gId, nodeId);
    if (token !== renderToken) return;

    for (const line of lines) bodyEl.appendChild(renderRelationRow(line));
    bodyEl.appendChild(makeAddRow(nodeId));
    updateActiveHighlight();
  };

  void render();

  // 四角の右クリックで参加が変わったら関係行を再取得（participants を最新に保つ）。
  const refresh = () => { void render(); };
  ctx.refreshRelations.add(refresh);

  const noPath: PaneViewPathEntry[] = [];
  return {
    el,
    load: () => render(),
    refresh: () => { void render(); },
    search: async () => { /* top-bar 検索は関係列には作用しない */ },
    // ノードを切り替えても「アクティブ関係」は保持する（両方に選択を持つ設計）。一覧だけ更新。
    setParent: async (nodeId) => { currentNodeId = nodeId; await render(); },
    getAncestorIds: () => new Set<string>(),
    getNodePath: () => noPath,
    getSelectedId: () => currentNodeId,
    getPaneParentId: () => currentNodeId,
    setLang: (l) => { lang = l; void render(); },
    setSourceRoot: async () => { currentNodeId = null; await render(); },
    beginKeyMove: () => false,
    acceptKeyMove: async () => { /* 関係列はノード移動先になれない */ },
    getEffectiveParentId: () => null,
    getNodeParentId: () => undefined,
    unregister: () => { ctx.refreshRelations.delete(refresh); menu.remove(); },
  };
}
