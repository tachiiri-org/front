import type { ExplorerNode, GraphEditorContext } from './types';
import { BORDER, TEXT_HIGH, TEXT_MID, TEXT_DIM, SELECT_STRONG, primaryLabel, fallbackLabel, showToast } from './constants';
import {
  fetchBookmarks, fetchBookmarkedNodes, fetchAllNodes,
  apiCreateNode, apiUpdateNode, apiDeleteNode, apiMoveBookmark,
} from './api';
import { getNodeOrder, type OrderMode } from './seriation';

// ── Flat node list ────────────────────────────────────────────────────────
// The graph editor is a FLAT node list + relation lines (no hierarchy / outliner). This pane shows
// every node as a top-level row; there are no children, expand/collapse, parents, or reparenting.
// The default view is the flat node list (same as an empty search); a bookmarks pane shows just the
// bookmarked nodes. Relations are edited in the relation panel, driven by the selected (focused) row.

/** One breadcrumb hop: the node id and its display label. Kept for the PanelView interface. */
export type PathEntry = { id: string | null; label: string };

export type NodePanelOpts = {
  /** Stable pane id (survives reload). */
  nodePanelId?: string;
  /** Marks this pane as sourced from another pane / the selection (vs the root/all-nodes pane). */
  sourceNodeId?: string | null;
  /** Breadcrumb path (root-first) inherited from the source pane. */
  nodePanelPath?: PathEntry[];
  /** Per-pane display/edit language (overrides the global default for this pane) */
  lang?: 'en' | 'ja';
  /** Called when user focuses a node row (for inter-pane wiring) */
  onNodeSelect?: (nodeId: string | null) => void;
  /** Called after render with the content's natural width (px); used by multi-pane for auto-sizing */
  onContentWidthChange?: (width: number) => void;
  /** Ctrl/Cmd+→/← on a focused node — no-op in the flat model (kept for interface compatibility). */
  onMoveNodeToNodePanel?: (nodeId: string, direction: 'left' | 'right') => boolean;
  /** Ctrl/Cmd+Shift+→/← while a node is focused: move THIS pane (column) one slot left/right. */
  onReorderNodePanel?: (direction: 'left' | 'right') => boolean;
};

export function createNodePanelView(ctx: GraphEditorContext, nodePanelOpts?: NodePanelOpts): {
  el: HTMLElement;
  load: () => Promise<void>;
  refresh: () => void;
  search: (query: string) => Promise<void>;
  setParent: (nodeId: string | null, excludeIds?: Set<string>, path?: PathEntry[]) => Promise<void>;
  getAncestorIds: (nodeId: string) => Set<string>;
  getNodePath: (nodeId: string) => PathEntry[];
  getSelectedId: () => string | null;
  getSourceNodeId: () => string | null;
  setLang: (l: 'en' | 'ja') => void;
  setSourceRoot: () => Promise<void>;
  beginKeyMove: (nodeId: string) => boolean;
  acceptKeyMove: () => Promise<void>;
  getEffectiveParentId: () => string | null;
  getNodeParentId: (nodeId: string) => string | null | undefined;
  unregister: () => void;
} {
  // Outer wrapper (returned as el)
  const el = document.createElement('div');
  el.style.cssText = `position:relative;flex:1;display:flex;flex-direction:column;overflow:hidden;`;

  // ── Search row (top) ──────────────────────────────────────────────────────
  // Per the graph's design principle (パーツだけで分かる) it carries NO helper/placeholder text; the
  // magnifier glyph is the affordance. Typing filters the pane to matching nodes (server search);
  // clearing (empty / Esc) restores the flat node list.
  let searchActive = false;
  const searchRow = document.createElement('div');
  searchRow.style.cssText = `display:flex;flex-shrink:0;align-items:center;padding:2px 8px 2px 6px;border-bottom:1px solid ${BORDER};`;
  const searchIconWrap = document.createElement('span');
  searchIconWrap.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;color:${TEXT_DIM};`;
  searchIconWrap.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="20" y1="20" x2="16.65" y2="16.65"></line></svg>';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.style.cssText = `flex:1;background:transparent;border:none;outline:none;font-size:14px;font-family:inherit;line-height:1.5;color:${TEXT_HIGH};padding:0 4px;min-height:20px;`;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  const runSearch = (q: string) => { searchActive = q.trim().length > 0; void search(q.trim()); };
  searchInput.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(searchInput.value), 200);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); searchInput.value = ''; if (searchTimer) clearTimeout(searchTimer); runSearch(''); searchInput.blur(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (searchTimer) clearTimeout(searchTimer); runSearch(searchInput.value); }
  });
  searchRow.append(searchIconWrap, searchInput);
  el.appendChild(searchRow);

  // ── Draft row (empty-state create) ────────────────────────────────────────
  const draftEl = document.createElement('div');
  draftEl.style.cssText = `display:none;align-items:center;padding:0;border:2px solid transparent;border-radius:3px;`;
  const draftSpacer = document.createElement('span');
  draftSpacer.style.cssText = `flex-shrink:0;width:6px;`;
  const draftBtnWrap = document.createElement('span');
  draftBtnWrap.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;`;
  const draftNodeBox = document.createElement('span');
  draftNodeBox.textContent = '＋';
  draftNodeBox.style.cssText = `display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;color:${TEXT_DIM};pointer-events:none;`;
  draftBtnWrap.appendChild(draftNodeBox);
  const draftTa = document.createElement('textarea');
  draftTa.rows = 1;
  draftTa.style.cssText = `flex:1;background:transparent;border:none;outline:none;resize:none;font-size:14px;font-family:inherit;line-height:1.5;padding:0 4px 0 0;overflow:hidden;min-height:20px;color:${TEXT_DIM};`;
  const draftResize = () => { draftTa.style.height = 'auto'; draftTa.style.height = draftTa.scrollHeight + 'px'; };
  draftTa.addEventListener('focus', () => { draftTa.style.color = TEXT_HIGH; });
  draftTa.addEventListener('blur', () => { if (!draftTa.value.trim()) draftTa.style.color = TEXT_DIM; });
  draftTa.addEventListener('input', draftResize);
  draftTa.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { draftTa.value = ''; draftTa.blur(); draftTa.style.color = TEXT_DIM; return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const label = draftTa.value.trim();
      draftTa.value = ''; draftResize(); draftTa.style.color = TEXT_DIM;
      await insertNode(0, label);
    }
  });
  draftEl.append(draftSpacer, draftBtnWrap, draftTa);
  el.appendChild(draftEl);

  // ── 並び順モード（実験用トグル）──────────────────────────────────────────────
  // ドメイン別に「重要度で種→関連度で整列」した順でノードを並べる。重要度(関係数/中心性)と
  // 整列(フロー/フィードラー)を切り替えて見比べられる。全てクライアント計算・派生。
  const orderMode: OrderMode = { importance: 'count', intra: 'flow' };
  const orderRow = document.createElement('div');
  orderRow.style.cssText = `flex-shrink:0;display:flex;align-items:center;gap:6px;padding:2px 8px 3px;border-bottom:1px solid ${BORDER};`;
  const mkToggle = (getText: () => string, cycle: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.style.cssText = `background:transparent;border:1px solid ${BORDER};color:${TEXT_MID};cursor:pointer;font-size:10px;padding:1px 6px;border-radius:3px;`;
    const upd = () => { b.textContent = getText(); };
    upd();
    b.addEventListener('click', () => { cycle(); upd(); void load(); });
    return b;
  };
  orderRow.append(
    mkToggle(() => `重要度: ${orderMode.importance === 'count' ? '関係数' : '中心性'}`, () => { orderMode.importance = orderMode.importance === 'count' ? 'evc' : 'count'; }),
    mkToggle(() => `整列: ${orderMode.intra === 'flow' ? 'フロー' : 'フィードラー'}`, () => { orderMode.intra = orderMode.intra === 'flow' ? 'fiedler' : 'flow'; }),
  );
  el.appendChild(orderRow);

  // ── Scrollable list ───────────────────────────────────────────────────────
  const listEl = document.createElement('div');
  listEl.dataset.nodePanelList = '1';
  listEl.style.cssText = `flex:1;overflow-y:auto;overflow-x:hidden;padding:4px 0;`;
  el.appendChild(listEl);

  // The displayed nodes, in order. One row per node (flat).
  let nodes: ExplorerNode[] = [];
  const nodeById = new Map<string, ExplorerNode>();
  // node id → row element.
  const rowMap = new Map<string, HTMLElement>();

  // Per-pane language (display + edit). Falls back to the global default when unset.
  let nodePanelLang: 'en' | 'ja' = nodePanelOpts?.lang ?? ctx.state.lang;

  // Pane state
  let sourceNodeSet = nodePanelOpts?.sourceNodeId !== undefined;
  let sourceNodeId: string | null = nodePanelOpts?.sourceNodeId ?? null;
  let nodePanelSelectedId: string | null = null;
  let externalPath: PathEntry[] = nodePanelOpts?.nodePanelPath ?? [];
  let loaded = false;

  // A pane is the "bookmarks" pane when the graph has no root AND this pane is not sourced from
  // another pane/selection. It shows the bookmarked nodes; every other pane shows the flat node list.
  const isBookmarkPane = (): boolean => !ctx.rootNodeId && !sourceNodeSet;

  const labelOf = (node: ExplorerNode): string =>
    primaryLabel(node, nodePanelLang) ?? fallbackLabel(node, nodePanelLang) ?? node.id.slice(0, 8);

  const setNodePanelSelected = (nodeId: string | null) => {
    nodePanelSelectedId = nodeId;
    nodePanelOpts?.onNodeSelect?.(nodeId);
  };

  // ── temp-id reconciliation (optimistic create) ──
  const tempReady = new Map<string, Promise<void>>();
  const awaitRealId = (node: ExplorerNode): Promise<void> => {
    if (!node.id.startsWith('temp-')) return Promise.resolve();
    return tempReady.get(node.id) ?? Promise.resolve();
  };

  // ── Selection (Shift+↑↓ range over the flat list) ──
  let selAnchorId: string | null = null;
  let selCurId: string | null = null;
  const getSelectedNodes = (): ExplorerNode[] => {
    if (!selAnchorId) return [];
    const ai = nodes.findIndex(n => n.id === selAnchorId);
    if (ai === -1) return [];
    if (!selCurId || selCurId === selAnchorId) return [nodes[ai]].filter(Boolean);
    const ci = nodes.findIndex(n => n.id === selCurId);
    if (ci === -1) return [nodes[ai]].filter(Boolean);
    return nodes.slice(Math.min(ai, ci), Math.max(ai, ci) + 1);
  };
  const isMultiSelect = () => getSelectedNodes().length > 1;
  const updateSelectionHighlight = () => {
    const sel = getSelectedNodes();
    const ids = sel.length > 1 ? new Set(sel.map(n => n.id)) : new Set<string>();
    rowMap.forEach((row, id) => { row.style.backgroundColor = ids.has(id) ? 'rgba(99,102,241,0.12)' : ''; });
  };
  const clearSelection = () => { selAnchorId = null; selCurId = null; updateSelectionHighlight(); };

  const focusRowById = (id: string) => {
    rowMap.get(id)?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  };

  // ── Node square (participation / selection fill) ──
  const updateNodeBox = (node: ExplorerNode) => {
    const row = rowMap.get(node.id);
    const m = row?.querySelector<HTMLElement>('[data-node-box]');
    if (!m) return;
    // 四角はデフォルトは輪郭のみ。関係(line)が選択中ならその参加ノードを塗り、関係が無いときは
    // 「選択中のノード」を塗る。
    const ar = ctx.activeRelation;
    const blue = ar ? ar.participants.has(node.id) : (node.id === nodePanelSelectedId);
    if (blue) { m.style.border = 'none'; m.style.background = SELECT_STRONG; }
    else { m.style.background = 'transparent'; m.style.border = `1.5px solid ${TEXT_DIM}`; }
  };

  // ── Cross-pane drag (node → relation panel only) ──
  // Node rows are draggable; the ONLY drop target is the relation panel (which converts the node
  // into a relation on the panel's current node). There is no reparent / cross-pane node move in the
  // flat model. The relation panel reads ctx.nodePanelDrag on drop.
  let dragKey: string | null = null;
  let dragMultiKeys: string[] | null = null;
  const nodePanelToken = {};

  // Remove the given nodes from this pane's list + DOM (called by the relation panel's
  // detachFromSource after it converts them into relations).
  const detachNodes = (removed: ExplorerNode[]) => {
    for (const node of removed) {
      const idx = nodes.findIndex(n => n.id === node.id);
      if (idx >= 0) nodes.splice(idx, 1);
      nodeById.delete(node.id);
      rowMap.get(node.id)?.remove();
      rowMap.delete(node.id);
    }
    updateDraftVisibility();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const updateDraftVisibility = () => {
    const showDraft = !isBookmarkPane() && nodes.length === 0 && !searchActive;
    draftEl.style.display = showDraft ? 'flex' : 'none';
  };

  const render = () => {
    rowMap.clear();
    listEl.innerHTML = '';
    for (const node of nodes) listEl.appendChild(buildRow(node));
    updateDraftVisibility();
    updateSelectionHighlight();
    if (nodePanelOpts?.onContentWidthChange) scheduleWidthUpdate();
  };

  // Set the pane's node list and render.
  const applyRoots = (list: ExplorerNode[]) => {
    nodes = list.slice();
    nodeById.clear();
    for (const n of nodes) nodeById.set(n.id, n);
    render();
  };

  // Canvas-based text width measurement — called after render to auto-size the pane width.
  const scheduleWidthUpdate = () => {
    requestAnimationFrame(() => {
      const minW = Math.max(280, Math.round(window.innerWidth * 0.20));
      const maxCap = Math.round(window.innerWidth * 0.40);
      const rows = listEl.querySelectorAll<HTMLElement>('[data-node-id]');
      const firstTa = rows[0]?.querySelector<HTMLTextAreaElement>('textarea');
      const font = firstTa ? getComputedStyle(firstTa).font : '14px sans-serif';
      const canvas = document.createElement('canvas');
      const c = canvas.getContext('2d')!;
      c.font = font;
      let maxW = 0;
      rows.forEach(row => {
        const spacer = row.querySelector<HTMLElement>('span');
        const ta = row.querySelector<HTMLTextAreaElement>('textarea');
        if (!ta) return;
        const spacerW = spacer?.offsetWidth ?? 0;
        const textW = Math.ceil(c.measureText(ta.value).width);
        maxW = Math.max(maxW, spacerW + 18 + textW + 48);
      });
      if (maxW === 0) { nodePanelOpts!.onContentWidthChange!(minW); return; }
      nodePanelOpts!.onContentWidthChange!(Math.min(Math.max(minW, maxW), maxCap));
      requestAnimationFrame(() => {
        listEl.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(ta => {
          ta.style.height = 'auto';
          ta.style.height = ta.scrollHeight + 'px';
        });
      });
    });
  };

  // ── Row builder ─────────────────────────────────────────────────────────
  const buildRow = (node: ExplorerNode): HTMLElement => {
    const row = document.createElement('div');
    row.dataset.nodeId = node.id;
    row.style.cssText = `display:flex;align-items:center;padding:0;border:2px solid transparent;border-radius:3px;`;
    rowMap.set(node.id, row);

    const spacer = document.createElement('span');
    spacer.style.cssText = `flex-shrink:0;width:6px;`;
    row.appendChild(spacer);

    // Left square: left-click = focus/select this row; right-click = toggle participation in the
    // active relation.
    const btnWrap = document.createElement('span');
    btnWrap.style.cssText = `flex-shrink:0;display:flex;align-items:center;justify-content:center;width:18px;cursor:pointer;`;
    const nodeBox = document.createElement('span');
    nodeBox.dataset.nodeBox = '1';
    nodeBox.style.cssText = `width:7px;height:7px;border-radius:1px;box-sizing:border-box;pointer-events:none;`;
    btnWrap.appendChild(nodeBox);
    btnWrap.addEventListener('click', (e) => { e.stopPropagation(); focusRowById(node.id); });
    btnWrap.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      void ctx.toggleParticipant(node.id);
    });
    row.appendChild(btnWrap);

    const label = primaryLabel(node, nodePanelLang) ?? fallbackLabel(node, nodePanelLang);
    const ta = document.createElement('textarea');
    ta.value = label;
    ta.style.cssText = `flex:1;background:transparent;border:none;outline:none;resize:none;font-size:14px;font-family:inherit;line-height:1.5;padding:0 4px 0 0;overflow:hidden;min-height:20px;color:${node.color ?? TEXT_HIGH};`;
    ta.rows = 1;

    const resize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    requestAnimationFrame(resize);
    ta.addEventListener('input', () => {
      resize();
      if (nodePanelOpts?.onContentWidthChange) scheduleWidthUpdate();
    });
    ta.addEventListener('focus', () => setNodePanelSelected(node.id));

    // Multi-line paste → one node per line: the first line merges into this row at the caret, each
    // remaining line becomes a new node below (in order). Single-line paste is left to the browser.
    ta.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length <= 1) return;
      e.preventDefault();
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      ta.value = ta.value.slice(0, start) + lines[0] + ta.value.slice(end);
      const caret = start + lines[0].length;
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event('input'));
      void (async () => {
        let anchorIdx = nodes.findIndex(n => n.id === node.id);
        for (let k = 1; k < lines.length; k++) {
          const created = await insertNode(anchorIdx + 1, lines[k]);
          if (!created) break;
          anchorIdx = nodes.findIndex(n => n.id === created.id);
        }
      })();
    });

    ta.addEventListener('blur', () => {
      const old = primaryLabel(node, nodePanelLang) ?? fallbackLabel(node, nodePanelLang);
      const newVal = ta.value;
      if (newVal !== old) {
        if (nodePanelLang === 'en') node.en = newVal; else node.ja = newVal;
        void apiUpdateNode(ctx.gId, node.id, nodePanelLang, newVal);
      }
    });

    ta.addEventListener('keydown', (e) => {
      const tAs = () => [...listEl.querySelectorAll<HTMLTextAreaElement>('textarea')];

      // Ctrl/Cmd+→/←        : (no-op in flat) move node to adjacent pane.
      // Ctrl/Cmd+Shift+→/←  : move THIS pane (column) one slot. Each only consumes the key when it
      // actually moved, so caret-by-word still works at the boundary.
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const dir = e.key === 'ArrowRight' ? 'right' : 'left';
        const moved = e.shiftKey
          ? nodePanelOpts?.onReorderNodePanel?.(dir)
          : nodePanelOpts?.onMoveNodeToNodePanel?.(node.id, dir);
        if (moved) { e.preventDefault(); return; }
      }

      // Shift+↑/↓: extend / shrink multi-select range
      if (e.key === 'ArrowUp' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const list = tAs();
        const tIdx = list.indexOf(ta);
        if (tIdx <= 0) return;
        if (!selAnchorId) selAnchorId = node.id;
        const prevId = list[tIdx - 1].closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
        if (prevId) { selCurId = prevId; updateSelectionHighlight(); }
        list[tIdx - 1].focus();
        return;
      }
      if (e.key === 'ArrowDown' && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const list = tAs();
        const tIdx = list.indexOf(ta);
        if (tIdx >= list.length - 1) return;
        if (!selAnchorId) selAnchorId = node.id;
        const nextId = list[tIdx + 1].closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
        if (nextId) { selCurId = nextId; updateSelectionHighlight(); }
        list[tIdx + 1].focus();
        return;
      }

      // Esc: clear multi-select
      if (e.key === 'Escape' && isMultiSelect()) {
        e.preventDefault(); e.stopPropagation(); clearSelection(); return;
      }

      // Shift+Alt+↑↓: reorder (bookmarks pane only — the flat all-nodes list has no persisted order).
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && e.altKey) {
        e.preventDefault();
        void doMove(node, e.key === 'ArrowUp' ? 'up' : 'down');
        return;
      }

      // Ctrl/Cmd+Shift+Backspace: delete (multi or single)
      if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        if (isMultiSelect()) void doDeleteMulti();
        else void doDelete(node);
        return;
      }

      // ↑/↓ — navigation; clear multi-select
      if (e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); clearSelection();
        const list = tAs(); const tIdx = list.indexOf(ta);
        if (tIdx > 0) list[tIdx - 1].focus();
        return;
      }
      if (e.key === 'ArrowDown' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); clearSelection();
        const list = tAs(); const tIdx = list.indexOf(ta);
        if (tIdx < list.length - 1) list[tIdx + 1].focus();
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); clearSelection();
        const before = ta.selectionStart === 0 && ta.selectionEnd === 0 && ta.value.length > 0;
        const idx = nodes.findIndex(n => n.id === node.id);
        void insertNode(before ? idx : idx + 1, '');
      } else if (e.key === 'Backspace' && ta.value === '') {
        e.preventDefault(); clearSelection(); void doDelete(node);
      }
    });

    // Long press (touch) / mouse drag → enable dragging this row onto the relation panel.
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let pressStartX = 0, pressStartY = 0;
    let dragReady = false;
    const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    row.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('button') || t.tagName === 'TEXTAREA') return;
      pressStartX = e.clientX; pressStartY = e.clientY;
      if (e.pointerType === 'mouse') { dragReady = true; row.draggable = true; }
      else {
        dragReady = false;
        pressTimer = setTimeout(() => { dragReady = true; row.draggable = true; row.style.opacity = '0.6'; }, 350);
      }
    });
    row.addEventListener('pointermove', (e) => {
      if (!pressTimer) return;
      if (Math.abs(e.clientX - pressStartX) > 5 || Math.abs(e.clientY - pressStartY) > 5) cancelPress();
    });
    row.addEventListener('pointerup', () => {
      cancelPress();
      if (!ctx.nodePanelDrag) { row.draggable = false; dragReady = false; }
    });
    row.addEventListener('pointercancel', () => { cancelPress(); row.draggable = false; dragReady = false; });

    row.addEventListener('dragstart', (e) => {
      if (!dragReady) { e.preventDefault(); return; }
      row.style.opacity = '0.6';
      dragKey = node.id;
      const sel = getSelectedNodes();
      dragMultiKeys = (sel.length > 1 && sel.some(n => n.id === node.id)) ? sel.map(n => n.id) : null;
      const dragNodes: ExplorerNode[] = dragMultiKeys
        ? dragMultiKeys.map(id => nodeById.get(id)).filter((n): n is ExplorerNode => !!n)
        : [node];
      ctx.nodePanelDrag = {
        sourceToken: nodePanelToken,
        nodeIds: dragNodes.map(n => n.id),
        movers: dragNodes.map(n => ({ node: n, oldParentId: null })),
        detachFromSource: (removed) => detachNodes(removed),
        awaitRealIds: () => Promise.all(dragNodes.map(n => awaitRealId(n))).then(() => {}),
      };
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id); }
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.style.opacity = '';
      dragReady = false;
      dragKey = null;
      dragMultiKeys = null;
      ctx.nodePanelDrag = null;
    });

    // Copy icon: node reference [id]ラベル をコピー。
    const copyIcon = document.createElement('button');
    copyIcon.textContent = '❐';
    copyIcon.title = 'ノード参照をコピー';
    copyIcon.style.cssText = `flex-shrink:0;background:transparent;border:none;color:${TEXT_DIM};cursor:pointer;font-size:12px;padding:0 6px;line-height:1;`;
    copyIcon.addEventListener('mousedown', (e) => e.preventDefault());
    copyIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      const lbl = primaryLabel(node, nodePanelLang) ?? fallbackLabel(node, nodePanelLang) ?? '';
      void navigator.clipboard.writeText(`[${node.id}]${lbl}`).then(() => showToast('コピーしました'));
    });

    row.appendChild(ta);
    row.appendChild(copyIcon);
    updateNodeBox(node);
    return row;
  };

  // ── Create (optimistic) ─────────────────────────────────────────────────
  // Insert a new flat node at `atIndex`, optimistically, then create it on the backend and swap the
  // temp id for the real one. Returns the (now real-id) node, or null if the create failed.
  const insertNode = async (atIndex: number, initialText: string): Promise<ExplorerNode | null> => {
    const tempId = `temp-${++ctx.tempNodeCounter}`;
    ctx.registerTempId(tempId);
    const tempNode: ExplorerNode = initialText ? { id: tempId, [nodePanelLang]: initialText } : { id: tempId };
    const at = Math.max(0, Math.min(atIndex, nodes.length));
    nodes.splice(at, 0, tempNode);
    nodeById.set(tempId, tempNode);

    // Targeted DOM insert (avoid a full re-render so any concurrent typing isn't lost).
    const newRow = buildRow(tempNode);
    const nextNode = nodes[at + 1];
    const nextRow = nextNode ? rowMap.get(nextNode.id) : null;
    if (nextRow) listEl.insertBefore(newRow, nextRow); else listEl.appendChild(newRow);
    updateDraftVisibility();
    focusRowById(tempId);

    let resolveTemp!: () => void;
    tempReady.set(tempId, new Promise<void>(res => { resolveTemp = res; }));

    const nn = await apiCreateNode(ctx.gId, nodePanelLang, initialText);
    if (!nn) {
      resolveTemp(); tempReady.delete(tempId);
      ctx.resolveTempId(tempId, tempId); // abandon: unblock any waiter (node was never created)
      const i = nodes.indexOf(tempNode); if (i >= 0) nodes.splice(i, 1);
      nodeById.delete(tempId);
      newRow.remove(); rowMap.delete(tempId);
      updateDraftVisibility();
      return null;
    }

    const typedText = newRow.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '';
    // temp id → real id: re-key the row + node.
    rowMap.delete(tempId);
    nodeById.delete(tempId);
    Object.assign(tempNode, nn); // copy labels/color; id becomes the real id
    rowMap.set(nn.id, newRow); newRow.dataset.nodeId = nn.id;
    nodeById.set(nn.id, tempNode);
    resolveTemp(); tempReady.delete(tempId);
    ctx.resolveTempId(tempId, nn.id);
    if (nodePanelSelectedId === tempId) setNodePanelSelected(nn.id);
    if (typedText.trim() && typedText.trim() !== initialText.trim()) void apiUpdateNode(ctx.gId, nn.id, nodePanelLang, typedText);
    return tempNode;
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  // Flat delete: remove the node entity. The backend 409-guards nodes that carry relation texts, so
  // we call the API first and only remove locally on success (keeps the caret when blocked).
  const doDelete = async (node: ExplorerNode) => {
    const idx = nodes.findIndex(n => n.id === node.id);
    const targetNode = nodes[idx - 1] ?? nodes[idx + 1] ?? null;
    const res = await apiDeleteNode(ctx.gId, node.id);
    if (!res.ok) {
      if (res.relationCount && res.relationCount > 0) {
        showToast(`関係テキストが${res.relationCount}件紐づくため削除できません（先に関係を外してください）`);
      } else {
        showToast('削除できませんでした');
      }
      return;
    }
    const i = nodes.findIndex(n => n.id === node.id);
    if (i >= 0) nodes.splice(i, 1);
    nodeById.delete(node.id);
    rowMap.get(node.id)?.remove(); rowMap.delete(node.id);
    updateDraftVisibility();
    if (targetNode) focusRowById(targetNode.id);
  };

  const doDeleteMulti = async () => {
    const sel = getSelectedNodes();
    if (sel.length === 0) return;
    const selIds = new Set(sel.map(n => n.id));
    // Focus target (list order): first non-selected row above the block, else the first below it.
    const firstIdx = nodes.findIndex(n => selIds.has(n.id));
    let lastIdx = firstIdx;
    for (let i = nodes.length - 1; i >= 0; i--) { if (selIds.has(nodes[i].id)) { lastIdx = i; break; } }
    const target = nodes[firstIdx - 1] ?? nodes[lastIdx + 1] ?? null;
    clearSelection();
    const results = await Promise.all(sel.map(n => apiDeleteNode(ctx.gId, n.id)));
    sel.forEach((n, i) => {
      if (!results[i].ok) return;
      const idx = nodes.findIndex(x => x.id === n.id);
      if (idx >= 0) nodes.splice(idx, 1);
      nodeById.delete(n.id);
      rowMap.get(n.id)?.remove(); rowMap.delete(n.id);
    });
    updateDraftVisibility();
    if (results.some(r => !r.ok)) showToast('関係テキストが紐づくため削除できないノードがありました');
    if (target && nodes.some(n => n.id === target.id)) focusRowById(target.id);
  };

  // ── Reorder (bookmarks pane only) ─────────────────────────────────────────
  const doMove = async (node: ExplorerNode, direction: 'up' | 'down') => {
    if (!isBookmarkPane()) return; // the flat all-nodes list has no persistable order
    const idx = nodes.findIndex(n => n.id === node.id);
    const newIdx = idx + (direction === 'up' ? -1 : 1);
    if (idx < 0 || newIdx < 0 || newIdx >= nodes.length) return;
    nodes.splice(idx, 1);
    nodes.splice(newIdx, 0, node);
    render();
    focusRowById(node.id);
    void apiMoveBookmark(ctx.gId, node.id, direction);
  };

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = async () => {
    loaded = true;
    clearSelection();
    // Bookmarks pane (no graph root, root-sourced): show the bookmarked nodes.
    if (isBookmarkPane()) {
      if (ctx.state.bookmarks.size === 0) {
        const ids = await fetchBookmarks(ctx.gId);
        ctx.state.bookmarks = new Set(ids);
      }
      const lang = ctx.state.showFallback ? undefined : nodePanelLang;
      const { nodes: bm } = await fetchBookmarkedNodes(ctx.gId, [...ctx.state.bookmarks], lang);
      applyRoots(bm);
      return;
    }
    // Every other pane: the flat node list, ordered by domain → importance-seed → relatedness.
    const lang = ctx.state.showFallback ? undefined : nodePanelLang;
    const { nodes: all } = await fetchAllNodes(ctx.gId, [], 0, lang, undefined, undefined, 2000);
    const rank = await getNodeOrder(ctx.gId, orderMode);
    all.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
    applyRoots(all);
  };

  const search = async (query: string) => {
    if (!query) { await load(); return; }
    const lang = ctx.state.showFallback ? undefined : nodePanelLang;
    const { nodes: found } = await fetchAllNodes(ctx.gId, [], 0, lang, undefined, query, 2000);
    const rank = await getNodeOrder(ctx.gId, orderMode);
    found.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
    applyRoots(found);
  };

  // ── PanelView interface ───────────────────────────────────────────────────
  // In the flat model there is no hierarchy: a sourced pane shows the same flat node list, so
  // setParent only records source/breadcrumb state and loads once. Cross-pane node moves and
  // ancestor/path queries are inert.
  const setParent = async (nodeId: string | null, _excludeIds?: Set<string>, path?: PathEntry[]) => {
    sourceNodeSet = true;
    sourceNodeId = nodeId;
    externalPath = path ?? [];
    if (!loaded) await load();
  };

  const getAncestorIds = (_nodeId: string): Set<string> => new Set<string>();

  const getNodePath = (nodeId: string): PathEntry[] => {
    const node = nodeById.get(nodeId);
    return [{ id: nodeId, label: node ? labelOf(node) : nodeId.slice(0, 8) }];
  };

  const getSelectedId = () => nodePanelSelectedId;
  const getSourceNodeId = () => (sourceNodeSet ? sourceNodeId : null);
  const setLang = (l: 'en' | 'ja') => { nodePanelLang = l; render(); };

  const setSourceRoot = async () => {
    sourceNodeSet = false;
    sourceNodeId = null;
    externalPath = [];
    nodePanelSelectedId = null;
    await load();
  };

  // Cross-pane key-move is a reparent operation — inert in the flat model.
  const beginKeyMove = (_nodeId: string): boolean => false;
  const acceptKeyMove = async (): Promise<void> => { /* no reparenting in the flat model */ };
  const getEffectiveParentId = (): string | null => null;
  const getNodeParentId = (_nodeId: string): string | null | undefined => undefined;

  // Redraw every square nodeBox — registered so the line panel can refresh participation fills
  // when the active relation (or its membership) changes.
  const rerenderAllNodeBoxes = () => { for (const n of nodes) updateNodeBox(n); };
  ctx.relationRerender.add(rerenderAllNodeBoxes);

  // Apply a rename made elsewhere (e.g. the relation panel breadcrumb) to this pane's rows.
  const applyExternalRename = (id: string, l: 'en' | 'ja', label: string) => {
    const n = nodeById.get(id);
    if (!n) return;
    n[l] = label;
    const ta = rowMap.get(id)?.querySelector<HTMLTextAreaElement>('textarea');
    const shown = primaryLabel(n, nodePanelLang) ?? fallbackLabel(n, nodePanelLang);
    if (ta && ta.value !== shown) ta.value = shown;
  };
  ctx.nodeRenamed.add(applyExternalRename);

  const unregister = () => {
    ctx.relationRerender.delete(rerenderAllNodeBoxes);
    ctx.nodeRenamed.delete(applyExternalRename);
  };

  return {
    el, load, refresh: render, search, setParent, getAncestorIds, getNodePath, getSelectedId,
    getSourceNodeId, setLang, setSourceRoot, beginKeyMove, acceptKeyMove, getEffectiveParentId,
    getNodeParentId, unregister,
  };
}
