import type { GraphEditorComponent } from '../../../../schema/component/kind/graph-editor';
import type { ExplorerNode, ExplorerState, GraphEditorContext } from './types';
import {
  BG, BORDER, TEXT_HIGH, TEXT_MID, SELECT_STRONG,
} from './constants';
import { createOutlinerView } from './outliner-view';
import { createMultiPaneView } from './multi-pane';

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

  // ── Language switcher ─────────────────────────────────────────────
  const topBar = document.createElement('div');
  topBar.style.cssText = `display:flex;align-items:center;padding:3px 8px;border-bottom:1px solid ${BORDER};flex-shrink:0;gap:4px;`;

  // ── View mode toggle ──────────────────────────────────────────────
  const VIEW_MODE_KEY = `graph-editor-view:${gId}`;
  const storedView = localStorage.getItem(VIEW_MODE_KEY);
  let viewMode: 'outline' | 'panes' = storedView === 'outline' ? 'outline' : 'panes';

  const makeViewBtnStyle = (mode: 'outline' | 'panes') => {
    const active = viewMode === mode;
    return `background:${active ? SELECT_STRONG : 'transparent'};border:1px solid ${active ? SELECT_STRONG : BORDER};color:${active ? TEXT_HIGH : TEXT_MID};cursor:pointer;font-size:11px;padding:1px 7px;border-radius:3px;line-height:1.5;`;
  };
  const outlineViewBtn = document.createElement('button');
  outlineViewBtn.textContent = 'アウトライン';
  outlineViewBtn.title = 'アウトラインビュー';
  const panesViewBtn = document.createElement('button');
  panesViewBtn.textContent = 'パネル';
  panesViewBtn.title = 'マルチパネルビュー';

  const refreshViewBtns = () => {
    outlineViewBtn.style.cssText = makeViewBtnStyle('outline');
    panesViewBtn.style.cssText = makeViewBtnStyle('panes');
  };
  refreshViewBtns();

  const sep = document.createElement('span');
  sep.style.cssText = `width:1px;height:14px;background:${BORDER};margin:0 2px;flex-shrink:0;`;
  topBar.appendChild(outlineViewBtn);
  topBar.appendChild(panesViewBtn);
  topBar.appendChild(sep);

  const makeLangBtnStyle = (l: 'en' | 'ja') => {
    const active = state.lang === l;
    return `background:${active ? SELECT_STRONG : 'transparent'};border:1px solid ${active ? SELECT_STRONG : BORDER};color:${active ? TEXT_HIGH : TEXT_MID};cursor:pointer;font-size:11px;padding:1px 7px;border-radius:3px;line-height:1.5;`;
  };

  const jaBtn = document.createElement('button');
  jaBtn.textContent = 'JA';
  const enBtn = document.createElement('button');
  enBtn.textContent = 'EN';

  const refreshLangBtns = () => {
    jaBtn.style.cssText = makeLangBtnStyle('ja');
    enBtn.style.cssText = makeLangBtnStyle('en');
  };
  refreshLangBtns();

  // Toggle: show/hide nodes that only exist in the other language
  const makeFallbackBtnStyle = () => {
    const active = state.showFallback;
    return `background:${active ? SELECT_STRONG : 'transparent'};border:1px solid ${active ? SELECT_STRONG : BORDER};color:${active ? TEXT_HIGH : TEXT_MID};cursor:pointer;font-size:11px;padding:1px 7px;border-radius:3px;line-height:1.5;`;
  };
  const fallbackBtn = document.createElement('button');
  fallbackBtn.textContent = '他言語';
  fallbackBtn.title = '現在の言語にテキストがなく他言語にのみあるノードの表示切り替え';
  fallbackBtn.style.cssText = makeFallbackBtnStyle();

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

  // doSearch is overwritten after the views are created (see below)
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

  const langSep = document.createElement('span');
  langSep.style.cssText = `width:1px;height:14px;background:${BORDER};margin:0 2px;flex-shrink:0;`;

  topBar.appendChild(searchSep);
  topBar.appendChild(searchInput);
  topBar.appendChild(clearBtn);
  topBar.appendChild(langSep);
  topBar.appendChild(fallbackBtn);
  topBar.appendChild(jaBtn);
  topBar.appendChild(enBtn);
  outer.appendChild(topBar);

  // Esc → focus search from anywhere inside the graph editor
  outer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  }, true);

  // ── Context assembly ──────────────────────────────────────────────
  // The view modules (outliner / multi-pane) close over `ctx` for shared config and
  // mutable state. The base object carries config + shared state; the views attach
  // their own callbacks via the propChangeHooks array.
  const rootNodeId = comp.rootNodeId ?? null;
  const propStore = new Map<string, Record<string, string>>();
  const allPropKeys = new Set<string>();
  const allPropColors = new Map<string, { colorId: string; code: string }>();
  const colorPalette = new Map<string, string>();
  const ctx = {
    gId, limit, rootNodeId, outer, state, childrenCache,
    propStore, allPropKeys, allPropColors, colorPalette,
    tempNodeCounter: 0,
    propChangeHooks: [] as Array<() => void>,
    saveChildrenCache,
    paneDrag: null,
  } as unknown as GraphEditorContext;

  // ── Outliner view (needs ctx) ──────────────────────────────────────
  const outliner = createOutlinerView(ctx);
  outliner.el.style.display = 'none';
  outer.appendChild(outliner.el);

  // ── Multi-pane view (needs ctx) ────────────────────────────────────
  const multiPane = createMultiPaneView(ctx);
  multiPane.el.style.display = 'none';
  outer.appendChild(multiPane.el);

  // Insert filter button into topBar, left of 他言語 toggle (outline mode only)
  const filterBtnSep = document.createElement('span');
  filterBtnSep.style.cssText = `width:1px;height:14px;background:${BORDER};margin:0 2px;flex-shrink:0;display:none;`;
  const filterBtnEl = outliner.filterBtn;
  filterBtnEl.style.cssText = `background:transparent;border:1px solid ${BORDER};color:${TEXT_MID};cursor:pointer;font-size:11px;padding:1px 7px;border-radius:3px;line-height:1.5;display:none;`;
  topBar.insertBefore(filterBtnSep, fallbackBtn);
  topBar.insertBefore(filterBtnEl, filterBtnSep);

  // Wire up search for all view modes now that the views exist
  doSearch = (q: string) => {
    state.searchQuery = q;
    if (viewMode === 'outline') {
      void outliner.search(q);
    } else {
      void multiPane.search(q);
    }
  };

  const switchView = (mode: 'outline' | 'panes') => {
    viewMode = mode;
    localStorage.setItem(VIEW_MODE_KEY, mode);
    refreshViewBtns();
    // Hide all views
    outliner.el.style.display = 'none';
    multiPane.el.style.display = 'none';
    filterBtnEl.style.display = 'none';
    filterBtnSep.style.display = 'none';

    if (mode === 'outline') {
      outliner.el.style.display = 'flex';
      outliner.el.style.flexDirection = 'column';
      filterBtnEl.style.display = '';
      filterBtnSep.style.display = '';
      void outliner.load();
    } else {
      multiPane.el.style.display = 'flex';
      void multiPane.load();
    }
  };
  outlineViewBtn.addEventListener('click', () => switchView('outline'));
  panesViewBtn.addEventListener('click', () => switchView('panes'));

  // ── Language / fallback wiring (needs ctx) ─────────────────────────
  const switchLang = (l: 'en' | 'ja') => {
    state.lang = l;
    refreshLangBtns();
    fallbackBtn.style.cssText = makeFallbackBtnStyle();
    if (viewMode === 'outline') {
      outliner.refresh();
    } else {
      multiPane.refresh();
    }
  };
  jaBtn.addEventListener('click', () => switchLang('ja'));
  enBtn.addEventListener('click', () => switchLang('en'));

  fallbackBtn.addEventListener('click', () => {
    state.showFallback = !state.showFallback;
    fallbackBtn.style.cssText = makeFallbackBtnStyle();
    if (viewMode === 'outline') {
      void outliner.load();
    } else {
      void multiPane.load();
    }
  });

  // Show the initial view (default: panes)
  switchView(viewMode);

  return outer;
}
