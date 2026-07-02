import type { GraphEditorComponent } from '../../../../schema/component/kind/graph-editor';
import type { ExplorerNode, ExplorerState, GraphEditorContext } from './types';
import {
  BG, BORDER, TEXT_HIGH, TEXT_MID, SELECT_STRONG,
} from './constants';
import { createMultiPaneView } from './multi-pane';
import { apiAddRay, apiRemoveRay } from './api';

export function renderGraphEditor(
  id: string,
  comp: GraphEditorComponent,
  graphId?: string,
): HTMLElement {
  const gId = graphId ?? comp.graphId;
  const limit = typeof comp.limit === 'number' && comp.limit > 0 ? comp.limit : 100;

  const state: ExplorerState = {
    graphId: gId,
    lang: comp.lang ?? 'ja',
    limit,
    bookmarks: new Set(),
    showFallback: false,
    searchQuery: '',
  };

  // In-memory cache: null key = all-nodes (col 0), string key = children of nodeId
  const childrenCache = new Map<string | null, ExplorerNode[]>();

  // ── Persistent children cache (localStorage) ──────────────────────
  const CACHE_KEY = `ge-cache:${gId}`;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const saved: { ts: number; entries: [string | null, ExplorerNode[]][] } = JSON.parse(raw);
      // Use cached data for up to 12 hours
      if (Date.now() - saved.ts < 12 * 60 * 60 * 1000) {
        for (const [k, v] of saved.entries) childrenCache.set(k, v);
      }
    }
  } catch {}

  let _cacheTimer: ReturnType<typeof setTimeout> | null = null;
  const saveChildrenCache = () => {
    if (_cacheTimer) clearTimeout(_cacheTimer);
    _cacheTimer = setTimeout(() => {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), entries: [...childrenCache.entries()] }));
      } catch {}
      _cacheTimer = null;
    }, 1500);
  };

  // ── Persistent relation-line count cache (localStorage) ──────────────
  // node id → 関係(line)件数。node id は不変なので、リロード直後もバッジを前回値で即表示し、
  // 裏の再取得(fetchLineCounts)で最新に更新する。これで移動＋更新時に件数が一瞬空になる見え方を防ぐ。
  const lineCountCache = new Map<string, number>();
  const LC_KEY = `ge-linecounts:${gId}`;
  try {
    const raw = localStorage.getItem(LC_KEY);
    if (raw) {
      const saved: { ts: number; entries: [string, number][] } = JSON.parse(raw);
      if (Date.now() - saved.ts < 12 * 60 * 60 * 1000) {
        for (const [k, v] of saved.entries) lineCountCache.set(k, v);
      }
    }
  } catch {}
  let _lcTimer: ReturnType<typeof setTimeout> | null = null;
  const saveLineCountCache = () => {
    if (_lcTimer) clearTimeout(_lcTimer);
    _lcTimer = setTimeout(() => {
      try {
        localStorage.setItem(LC_KEY, JSON.stringify({ ts: Date.now(), entries: [...lineCountCache.entries()] }));
      } catch {}
      _lcTimer = null;
    }, 1500);
  };

  const outer = document.createElement('div');
  outer.id = id;
  outer.style.cssText = `position:relative;display:flex;flex-direction:column;height:100%;background:${BG};color:${TEXT_HIGH};font-family:sans-serif;font-size:13px;line-height:1.5;overflow:hidden;`;

  // Scrollbar styles
  const style = document.createElement('style');
  style.textContent = `
    #${id} ::-webkit-scrollbar { width: 6px; height: 6px; }
    #${id} ::-webkit-scrollbar-track { background: transparent; }
    #${id} ::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
    #${id} * { scrollbar-width: thin; scrollbar-color: #555 transparent; }
  `;
  outer.appendChild(style);

  // 上部バー（全体ヘッダ）は廃止。言語切替はパネルごと、検索バーも撤去した。

  // ── Context assembly ──────────────────────────────────────────────
  const rootNodeId = comp.rootNodeId ?? null;
  const colorPalette = new Map<string, string>();
  const relationRerender = new Set<() => void>();
  const refreshRelations = new Set<() => void>();
  const ctx = {
    gId, limit, rootNodeId, outer, state, childrenCache,
    colorPalette,
    tempNodeCounter: 0,
    saveChildrenCache,
    lineCountCache,
    saveLineCountCache,
    paneDrag: null,
    activeRelation: null,
    relationRerender,
    refreshRelations,
    setActiveRelation: (r: { lineId: string; participants: Set<string> } | null) => {
      ctx.activeRelation = r;
      relationRerender.forEach((f) => f());
    },
    toggleParticipant: async (nodeId: string) => {
      const ar = ctx.activeRelation;
      if (!ar) return;
      if (ar.participants.has(nodeId)) {
        await apiRemoveRay(gId, ar.lineId, nodeId);
        ar.participants.delete(nodeId);
      } else {
        await apiAddRay(gId, ar.lineId, nodeId);
        ar.participants.add(nodeId);
      }
      relationRerender.forEach((f) => f());
      refreshRelations.forEach((f) => f()); // re-fetch relation rows so participants stay fresh
    },
  } as unknown as GraphEditorContext;

  // ── Multi-pane view ───────────────────────────────────────────────
  const multiPane = createMultiPaneView(ctx);
  multiPane.el.style.display = 'flex';
  outer.appendChild(multiPane.el);

  void multiPane.load();

  return outer;
}
