import type { GraphEditorComponent } from '../../../../schema/component/kind/graph-editor';
import type { ExplorerNode, ExplorerState, GraphEditorContext } from './types';
import {
  BG, BORDER, TEXT_HIGH, TEXT_MID, SELECT_STRONG,
  primaryLabel, fallbackLabel,
} from './constants';
import { fetchBookmarks } from './api';
import { createColumnFns } from './column';
import { createNodeRowFns } from './node-row';
import { createDeleteFns } from './delete';
import { createOutlinerView } from './outliner-view';

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
    columns: [],
    bookmarks: new Set(),
    showFallback: false,
    linkSourceId: null,
    linkedNodeIds: new Set(),
    searchQuery: '',
  };

  // In-memory cache: null key = all-nodes (col 0), string key = children of nodeId
  const childrenCache = new Map<string | null, ExplorerNode[]>();

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
  topBar.style.cssText = `display:flex;justify-content:flex-end;align-items:center;padding:3px 8px;border-bottom:1px solid ${BORDER};flex-shrink:0;gap:4px;`;

  // ── View mode toggle ──────────────────────────────────────────────
  let viewMode: 'columns' | 'outline' = 'columns';

  const makeViewBtnStyle = (mode: 'columns' | 'outline') => {
    const active = viewMode === mode;
    return `background:${active ? SELECT_STRONG : 'transparent'};border:1px solid ${active ? SELECT_STRONG : BORDER};color:${active ? TEXT_HIGH : TEXT_MID};cursor:pointer;font-size:11px;padding:1px 7px;border-radius:3px;line-height:1.5;`;
  };
  const colViewBtn = document.createElement('button');
  colViewBtn.textContent = '列';
  colViewBtn.title = 'カラムビュー';
  const outlineViewBtn = document.createElement('button');
  outlineViewBtn.textContent = 'アウトライン';
  outlineViewBtn.title = 'アウトラインビュー';

  const refreshViewBtns = () => {
    colViewBtn.style.cssText = makeViewBtnStyle('columns');
    outlineViewBtn.style.cssText = makeViewBtnStyle('outline');
  };
  refreshViewBtns();

  const sep = document.createElement('span');
  sep.style.cssText = `width:1px;height:14px;background:${BORDER};margin:0 2px;flex-shrink:0;`;
  topBar.appendChild(colViewBtn);
  topBar.appendChild(outlineViewBtn);
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

  topBar.appendChild(fallbackBtn);
  topBar.appendChild(jaBtn);
  topBar.appendChild(enBtn);
  outer.appendChild(topBar);

  // ── Search bar ────────────────────────────────────────────────────
  const searchBar = document.createElement('div');
  searchBar.style.cssText = `display:flex;align-items:center;padding:4px 8px;border-bottom:1px solid ${BORDER};flex-shrink:0;gap:6px;`;

  const searchIcon = document.createElement('span');
  searchIcon.textContent = '🔍';
  searchIcon.style.cssText = `flex-shrink:0;font-size:12px;opacity:0.5;`;

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'ノードを検索…';
  Object.assign(searchInput.style, {
    flex: '1', background: 'transparent', border: 'none', outline: 'none',
    color: TEXT_HIGH, fontSize: '13px', fontFamily: 'inherit', lineHeight: '1.5',
  });

  const clearBtn = document.createElement('button');
  clearBtn.textContent = '✕';
  clearBtn.style.cssText = `background:transparent;border:none;color:${TEXT_MID};cursor:pointer;font-size:12px;padding:0 2px;display:none;`;
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    state.searchQuery = '';
    childrenCache.delete(null);
    void ctx.loadColumn(null, 0);
    searchInput.focus();
  });

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    clearBtn.style.display = q ? 'block' : 'none';
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchQuery = q;
      childrenCache.delete(null);
      void ctx.loadColumn(null, 0);
    }, 250);
  });

  searchBar.appendChild(searchIcon);
  searchBar.appendChild(searchInput);
  searchBar.appendChild(clearBtn);
  outer.appendChild(searchBar);

  // ── Breadcrumb ───────────────────────────────────────────────────
  const breadcrumbEl = document.createElement('div');
  breadcrumbEl.style.cssText = `
    padding:4px 12px;border-bottom:1px solid ${BORDER};flex-shrink:0;
    font-size:12px;color:${TEXT_MID};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  `;
  breadcrumbEl.textContent = 'ルート';
  outer.appendChild(breadcrumbEl);

  const refreshBreadcrumb = () => {
    breadcrumbEl.innerHTML = '';
    const addSpan = (text: string, highlight = false) => {
      const s = document.createElement('span');
      s.textContent = text;
      s.style.color = highlight ? TEXT_HIGH : TEXT_MID;
      breadcrumbEl.appendChild(s);
    };
    addSpan('ルート');
    for (const col of state.columns) {
      if (!col.selectedId) break;
      const node = col.nodes.find((n) => n.id === col.selectedId);
      if (!node) break;
      addSpan(' › ', false);
      addSpan(primaryLabel(node, state.lang) ?? fallbackLabel(node, state.lang), true);
    }
  };

  // ── Columns area ──────────────────────────────────────────────────
  const columnsEl = document.createElement('div');
  columnsEl.style.cssText = `display:flex;flex:1;overflow-x:auto;overflow-y:hidden;`;
  outer.appendChild(columnsEl);


  // ── Context assembly ──────────────────────────────────────────────
  // The callback fields are filled in by the module factories below; until then the
  // base object only carries config + shared mutable state. Every factory closes over
  // `ctx` and resolves the other modules' callbacks lazily (at event time), which is
  // what lets the mutually-recursive render functions live in separate files.
  const rootNodeId = comp.rootNodeId ?? null;
  const ctx = {
    gId, limit, rootNodeId, outer, columnsEl, state, childrenCache,
    columnVersion: 0, tempNodeCounter: 0, pendingDeleteId: null,
  } as unknown as GraphEditorContext;
  Object.assign(ctx, createColumnFns(ctx), createNodeRowFns(ctx), createDeleteFns(ctx));
  ctx.refreshBreadcrumb = refreshBreadcrumb;

  // ── Outliner view (needs ctx) ──────────────────────────────────────
  const outliner = createOutlinerView(ctx);
  outliner.el.style.display = 'none';
  outer.appendChild(outliner.el);

  const switchView = (mode: 'columns' | 'outline') => {
    viewMode = mode;
    refreshViewBtns();
    if (mode === 'outline') {
      columnsEl.style.display = 'none';
      breadcrumbEl.style.display = 'none';
      outliner.el.style.display = 'flex';
      outliner.el.style.flexDirection = 'column';
      void outliner.load();
    } else {
      outliner.el.style.display = 'none';
      columnsEl.style.display = 'flex';
      breadcrumbEl.style.display = '';
    }
  };
  colViewBtn.addEventListener('click', () => switchView('columns'));
  outlineViewBtn.addEventListener('click', () => switchView('outline'));

  // ── Language / fallback wiring (needs ctx) ─────────────────────────
  const switchLang = (l: 'en' | 'ja') => {
    state.lang = l;
    refreshLangBtns();
    fallbackBtn.style.cssText = makeFallbackBtnStyle();
    if (viewMode === 'outline') {
      outliner.refresh();
    } else if (!state.showFallback) {
      // Re-fetch col0 with new lang filter
      childrenCache.delete(null);
      void ctx.loadColumn(null, 0);
    } else {
      ctx.rebuildAll();
    }
    refreshBreadcrumb();
  };
  jaBtn.addEventListener('click', () => switchLang('ja'));
  enBtn.addEventListener('click', () => switchLang('en'));

  fallbackBtn.addEventListener('click', () => {
    state.showFallback = !state.showFallback;
    fallbackBtn.style.cssText = makeFallbackBtnStyle();
    if (viewMode === 'outline') {
      void outliner.load();
    } else {
      childrenCache.delete(null);
      void ctx.loadColumn(null, 0);
    }
  });

  if (rootNodeId) {
    void ctx.loadColumn(null, 0);
  } else {
    fetchBookmarks(gId).then((ids) => {
      state.bookmarks = new Set(ids);
      void ctx.loadColumn(null, 0);
    });
  }

  return outer;
}
