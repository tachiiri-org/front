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

  // ── Top bar ───────────────────────────────────────────────────────
  const topBar = document.createElement('div');
  topBar.style.cssText = `display:flex;align-items:center;padding:3px 8px;border-bottom:1px solid ${BORDER};flex-shrink:0;gap:4px;`;

  // 言語切替はパネルごと（各ノードパネル / 関係パネルの JA/EN）に移動。トップバーの全体トグル
  // （他言語 / JA / EN）は廃止した。

  // ── Search input (in topBar) ──────────────────────────────────────
  const searchSep = document.createElement('span');
  searchSep.style.cssText = `width:1px;height:14px;background:${BORDER};margin:0 2px;flex-shrink:0;`;

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  Object.assign(searchInput.style, {
    flex: '1', background: 'transparent', border: 'none', outline: 'none',
    color: TEXT_HIGH, fontSize: '12px', fontFamily: 'inherit', lineHeight: '1.5',
    minWidth: '60px',
  });

  const clearBtn = document.createElement('button');
  clearBtn.textContent = '✕';
  clearBtn.style.cssText = `background:transparent;border:none;color:${TEXT_MID};cursor:pointer;font-size:12px;padding:0 2px;display:none;flex-shrink:0;`;
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    doSearch('');
    searchInput.focus();
  });

  // doSearch is overwritten after the view is created (see below)
  let doSearch = (q: string) => {
    state.searchQuery = q;
  };

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    clearBtn.style.display = q ? 'block' : 'none';
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(q), 250);
  });

  topBar.appendChild(searchSep);
  topBar.appendChild(searchInput);
  topBar.appendChild(clearBtn);
  outer.appendChild(topBar);

  // Esc → focus search from anywhere inside the graph editor
  outer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  }, true);

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

  doSearch = (q: string) => {
    state.searchQuery = q;
    void multiPane.search(q);
  };

  void multiPane.load();

  return outer;
}
