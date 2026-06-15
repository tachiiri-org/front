import type { GraphExplorerComponent } from '../../../../schema/component/kind/graph-explorer';

type ExplorerNode = { id: string; en?: string; ja?: string; color?: string };

type ExplorerColumn = {
  parentId: string | null; // null for column 0 (all-nodes view)
  nodes: ExplorerNode[];
  loading: boolean;
  selectedId: string | null;
  hasMore?: boolean;   // col 0 pagination
  nextOffset?: number; // next page offset for col 0
};

type ExplorerState = {
  graphId: string;
  lang: 'en' | 'ja';
  limit: number;
  columns: ExplorerColumn[];
  bookmarks: Set<string>;
};

const BG = '#1e1e1e';
const BORDER = '#333';
const TEXT_HIGH = '#e0e0e0';
const TEXT_MID = '#aaa';
const TEXT_DIM = '#555';
const SELECT_STRONG = '#3a6ea8';

const PRESET_COLORS: Array<string | null> = [
  'rgba(255,190,60,0.90)',
  'rgba(200,120,255,0.90)',
  'rgba(60,220,120,0.90)',
  'rgba(80,160,255,0.90)',
  'rgba(255,100,100,0.90)',
  'rgba(60,220,220,0.90)',
  null,
];

function primaryLabel(node: ExplorerNode, lang: 'en' | 'ja'): string | null {
  return lang === 'en' ? (node.en ?? null) : (node.ja ?? null);
}

function fallbackLabel(node: ExplorerNode, lang: 'en' | 'ja'): string {
  const other = lang === 'en' ? node.ja : node.en;
  return other ?? node.id.slice(0, 8);
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(input, init);
  if (r.status === 401) { window.location.href = '/login'; }
  return r;
}

async function fetchAllNodes(
  graphId: string,
  includeIds: string[] = [],
  offset = 0,
): Promise<{ nodes: ExplorerNode[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: '20', offset: String(offset) });
  if (includeIds.length > 0) params.set('include', includeIds.join(','));
  const r = await apiFetch(`/api/graph/${graphId}/nodes?${params}`);
  if (!r.ok) return { nodes: [], hasMore: false };
  const data = await r.json() as { nodes: ExplorerNode[]; hasMore?: boolean };
  return { nodes: data.nodes ?? [], hasMore: data.hasMore ?? false };
}

async function fetchChildren(graphId: string, nodeId: string, limit: number): Promise<ExplorerNode[]> {
  const r = await apiFetch(`/api/graph/${graphId}/node/${nodeId}/children?limit=${limit}`);
  if (!r.ok) return [];
  const data = await r.json() as { nodes: ExplorerNode[] };
  return data.nodes ?? [];
}

async function apiCreateNode(
  graphId: string, parentId: string | null, lang: 'en' | 'ja', label: string,
): Promise<ExplorerNode | null> {
  const body = lang === 'en'
    ? (parentId ? { parentId, en: label } : { en: label })
    : (parentId ? { parentId, ja: label } : { ja: label });
  const r = await apiFetch(`/api/graph/${graphId}/node`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  return r.json() as Promise<ExplorerNode>;
}

async function apiUpdateNode(
  graphId: string, nodeId: string, lang: 'en' | 'ja', label: string,
): Promise<void> {
  const body = lang === 'en' ? { en: label || null } : { ja: label || null };
  await apiFetch(`/api/graph/${graphId}/node/${nodeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function apiUpdateColor(
  graphId: string, nodeId: string, color: string | null,
): Promise<void> {
  await apiFetch(`/api/graph/${graphId}/node/${nodeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ color }),
  });
}

async function apiDeleteNode(graphId: string, nodeId: string): Promise<void> {
  await apiFetch(`/api/graph/${graphId}/node/${nodeId}`, { method: 'DELETE' });
}

const BOOKMARK_KEY_PREFIX = 'ge-bookmarks:';

function loadBookmarks(graphId: string): Set<string> {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY_PREFIX + graphId);
    if (raw) {
      const ids = JSON.parse(raw) as unknown;
      if (Array.isArray(ids)) return new Set(ids.filter((v) => typeof v === 'string') as string[]);
    }
  } catch (err) {
    console.error('[graph-explorer] loadBookmarks error', err);
  }
  return new Set();
}

function saveBookmarks(graphId: string, bookmarks: Set<string>): void {
  try {
    localStorage.setItem(BOOKMARK_KEY_PREFIX + graphId, JSON.stringify(Array.from(bookmarks)));
  } catch (err) {
    console.error('[graph-explorer] saveBookmarks error', err);
  }
}

export function renderGraphExplorer(
  id: string,
  comp: GraphExplorerComponent,
  graphId?: string,
): HTMLElement {
  const gId = graphId ?? comp.graphId;
  const limit = typeof comp.limit === 'number' && comp.limit > 0 ? comp.limit : 100;

  const state: ExplorerState = {
    graphId: gId,
    lang: comp.lang ?? 'ja',
    limit,
    columns: [],
    bookmarks: loadBookmarks(gId),
  };

  // In-memory cache: null key = all-nodes (col 0), string key = children of nodeId
  const childrenCache = new Map<string | null, ExplorerNode[]>();

  let columnVersion = 0;

  const outer = document.createElement('div');
  outer.id = id;
  outer.style.cssText = `display:flex;flex-direction:column;height:100%;background:${BG};color:${TEXT_HIGH};font-family:sans-serif;font-size:13px;line-height:1.5;overflow:hidden;`;

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

  const makeBtnStyle = (l: 'en' | 'ja') => {
    const active = state.lang === l;
    return `background:${active ? SELECT_STRONG : 'transparent'};border:1px solid ${active ? SELECT_STRONG : BORDER};color:${active ? TEXT_HIGH : TEXT_MID};cursor:pointer;font-size:11px;padding:1px 7px;border-radius:3px;line-height:1.5;`;
  };

  const jaBtn = document.createElement('button');
  jaBtn.textContent = 'JA';
  const enBtn = document.createElement('button');
  enBtn.textContent = 'EN';

  const refreshLangBtns = () => {
    jaBtn.style.cssText = makeBtnStyle('ja');
    enBtn.style.cssText = makeBtnStyle('en');
  };
  refreshLangBtns();

  const switchLang = (l: 'en' | 'ja') => {
    state.lang = l;
    refreshLangBtns();
    rebuildAll();
    refreshBreadcrumb();
  };
  jaBtn.addEventListener('click', () => switchLang('ja'));
  enBtn.addEventListener('click', () => switchLang('en'));
  topBar.appendChild(jaBtn);
  topBar.appendChild(enBtn);
  outer.appendChild(topBar);

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

  const rebuildAll = () => {
    columnsEl.innerHTML = '';
    for (let i = 0; i < state.columns.length; i++) {
      columnsEl.appendChild(buildColumnEl(i));
    }
  };

  const appendColumn = (colIndex: number) => {
    const existing = columnsEl.children;
    while (existing.length > colIndex) {
      columnsEl.removeChild(existing[existing.length - 1]);
    }
    columnsEl.appendChild(buildColumnEl(colIndex));
  };

  const fetchCached = async (parentId: string | null): Promise<{ nodes: ExplorerNode[]; hasMore: boolean }> => {
    if (childrenCache.has(parentId)) return { nodes: childrenCache.get(parentId)!, hasMore: false };
    if (parentId === null) {
      const result = await fetchAllNodes(gId, [...state.bookmarks], 0);
      childrenCache.set(null, result.nodes);
      return result;
    }
    const nodes = await fetchChildren(gId, parentId, limit);
    childrenCache.set(parentId, nodes);
    return { nodes, hasMore: false };
  };

  // parentId=null means "load all nodes" (column 0)
  const loadColumn = async (parentId: string | null, colIndex: number) => {
    const version = ++columnVersion;
    state.columns = state.columns.slice(0, colIndex);

    // Cache hit: render immediately without loading state
    if (childrenCache.has(parentId)) {
      const cached = childrenCache.get(parentId)!;
      state.columns.push({ parentId, nodes: cached, loading: false, selectedId: null, hasMore: false, nextOffset: cached.length });
      appendColumn(colIndex);
      return;
    }

    // Cache miss: show loading spinner, then fetch
    state.columns.push({ parentId, nodes: [], loading: true, selectedId: null, hasMore: false, nextOffset: 0 });
    appendColumn(colIndex);

    const { nodes, hasMore } = await fetchCached(parentId);
    if (version !== columnVersion) return;
    if (state.columns[colIndex]) {
      state.columns[colIndex].nodes = nodes;
      state.columns[colIndex].loading = false;
      state.columns[colIndex].hasMore = hasMore;
      state.columns[colIndex].nextOffset = nodes.length;
    }
    const colEl = columnsEl.children[colIndex] as HTMLElement | undefined;
    if (colEl) {
      columnsEl.replaceChild(buildColumnEl(colIndex), colEl);
    }
  };

  const onNodeFocus = (colIndex: number, nodeId: string) => {
    if (state.columns[colIndex]?.selectedId === nodeId) return;
    if (state.columns[colIndex]) state.columns[colIndex].selectedId = nodeId;
    void loadColumn(nodeId, colIndex + 1);
    refreshRowStyles(colIndex);
    refreshBreadcrumb();
  };

  const refreshRowStyles = (colIndex: number) => {
    const colEl = columnsEl.children[colIndex];
    if (!colEl) return;
    const selectedId = state.columns[colIndex]?.selectedId;
    colEl.querySelectorAll<HTMLElement>('[data-node-id]:not(textarea)').forEach((row) => {
      const isSelected = row.dataset.nodeId === selectedId;
      row.style.background = 'transparent';
      row.style.borderLeft = `2px solid ${isSelected ? SELECT_STRONG : 'transparent'}`;
    });
  };

  const showColorPicker = (anchor: HTMLElement, node: ExplorerNode, colIndex: number) => {
    document.querySelector('.ge-color-picker')?.remove();
    const picker = document.createElement('div');
    picker.className = 'ge-color-picker';
    picker.style.cssText = `
      position:fixed;display:flex;align-items:center;gap:6px;
      background:#2a2a2a;border:1px solid ${BORDER};border-radius:6px;
      padding:6px 8px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.5);
    `;
    const rect = anchor.getBoundingClientRect();
    picker.style.left = `${rect.left}px`;
    picker.style.top = `${rect.bottom + 4}px`;

    for (const c of PRESET_COLORS) {
      const swatch = document.createElement('div');
      swatch.style.cssText = `
        width:16px;height:16px;border-radius:3px;cursor:pointer;box-sizing:border-box;
        background:${c ?? 'transparent'};
        border:${c ? 'none' : `1.5px solid ${TEXT_DIM}`};
        display:flex;align-items:center;justify-content:center;
        color:${TEXT_DIM};font-size:11px;
      `;
      if (!c) swatch.textContent = '×';
      swatch.addEventListener('mousedown', (e) => {
        e.preventDefault();
        node.color = c ?? undefined;
        void apiUpdateColor(gId, node.id, c);
        const colEl = columnsEl.children[colIndex];
        if (colEl) {
          const row = colEl.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`);
          if (row) {
            const markerEl = row.querySelector<HTMLElement>('[data-marker]');
            if (markerEl) {
              markerEl.style.background = node.color ?? 'transparent';
              markerEl.style.border = node.color ? 'none' : `1.5px solid ${TEXT_DIM}`;
            }
          }
        }
        picker.remove();
      });
      picker.appendChild(swatch);
    }

    document.body.appendChild(picker);
    const dismiss = (e: MouseEvent) => {
      if (!picker.contains(e.target as Node)) {
        picker.remove();
        document.removeEventListener('mousedown', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  };

  const deleteNode = (node: ExplorerNode, colIndex: number, focusNodeId?: string) => {
    const parentId = state.columns[colIndex]?.parentId ?? null;
    void apiDeleteNode(gId, node.id).then(() => {
      // Invalidate cache for this column's source
      childrenCache.delete(parentId);
      if (state.columns[colIndex]) {
        state.columns[colIndex].nodes = state.columns[colIndex].nodes.filter((n) => n.id !== node.id);
        if (state.columns[colIndex].selectedId === node.id) {
          state.columns[colIndex].selectedId = null;
          state.columns = state.columns.slice(0, colIndex + 1);
        }
      }
      rebuildAll();
      refreshBreadcrumb();
      // Re-focus the node above (or below if it was first)
      if (focusNodeId) {
        const colEl = columnsEl.children[colIndex] as HTMLElement | undefined;
        const target = colEl?.querySelector<HTMLTextAreaElement>(`textarea[data-node-id="${focusNodeId}"]`);
        if (target) {
          target.focus();
          target.setSelectionRange(target.value.length, target.value.length);
        }
      }
    });
  };

  const buildColumnEl = (colIndex: number): HTMLElement => {
    const col = state.columns[colIndex];

    const colEl = document.createElement('div');
    colEl.style.cssText = `
      width:fit-content;max-width:40%;min-width:160px;
      display:flex;flex-direction:column;
      border-right:1px solid ${BORDER};
      flex-shrink:0;overflow:hidden;
    `;

    // ── Item list ─────────────────────────────────────────────────
    const list = document.createElement('div');
    list.dataset.list = '1';
    list.style.cssText = `flex:1;overflow-y:auto;padding:4px 0;`;

    // Draft row — same structure as node rows
    const draftRow = document.createElement('div');
    draftRow.style.cssText = `display:flex;align-items:flex-start;gap:4px;padding:1px 8px 1px 8px;flex-shrink:0;background:transparent;border-left:2px solid transparent;`;
    const draftStar = document.createElement('span');
    draftStar.textContent = '☆';
    draftStar.style.cssText = `flex-shrink:0;align-self:center;font-size:10px;line-height:1;color:transparent;margin-top:1px;user-select:none;`;
    const draftMarker = document.createElement('span');
    draftMarker.style.cssText = `width:6px;height:6px;flex-shrink:0;align-self:center;border-radius:1px;box-sizing:border-box;background:transparent;border:1.5px solid ${TEXT_DIM};margin-top:1px;`;
    const draftInput = document.createElement('textarea');
    draftInput.rows = 1;
    Object.assign(draftInput.style, {
      display: 'block', width: '100%', border: 'none', outline: 'none', resize: 'none',
      overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit',
      padding: '2px 4px', boxSizing: 'border-box', background: 'transparent', color: TEXT_MID,
    });
    (draftInput.style as unknown as Record<string, string>)['field-sizing'] = 'content';
    draftInput.addEventListener('focus', () => { draftInput.style.color = TEXT_HIGH; });
    draftInput.addEventListener('blur', () => { draftInput.style.color = TEXT_MID; });
    draftInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      const val = draftInput.value.trim();
      if (!val) return;
      draftInput.value = '';
      childrenCache.delete(col.parentId);
      const newNode = await apiCreateNode(gId, col.parentId, state.lang, val);
      if (newNode && state.columns[colIndex]) {
        state.columns[colIndex].nodes.push(newNode);
        list.appendChild(buildNodeRow(newNode, colIndex));
        void onNodeFocus(colIndex, newNode.id);
      }
    });
    draftRow.appendChild(draftStar);
    draftRow.appendChild(draftMarker);
    draftRow.appendChild(draftInput);
    list.appendChild(draftRow);

    if (col.loading) {
      const msg = document.createElement('div');
      msg.textContent = '読み込み中...';
      msg.style.cssText = `padding:4px 12px;color:${TEXT_DIM};font-size:13px;`;
      list.appendChild(msg);
    } else {
      // Bookmarked nodes pinned to top in column 0
      const nodes = colIndex === 0
        ? [
            ...col.nodes.filter((n) => state.bookmarks.has(n.id)),
            ...col.nodes.filter((n) => !state.bookmarks.has(n.id)),
          ]
        : col.nodes;
      for (const node of nodes) {
        list.appendChild(buildNodeRow(node, colIndex));
      }

      // "Load more" button for column 0 pagination
      if (colIndex === 0 && col.hasMore) {
        const moreBtn = document.createElement('button');
        moreBtn.textContent = 'さらに読み込む';
        moreBtn.style.cssText = `
          display:block;width:100%;padding:4px 12px;
          background:transparent;border:none;border-top:1px solid ${BORDER};
          color:${TEXT_MID};font-size:12px;cursor:pointer;text-align:left;
        `;
        moreBtn.addEventListener('mouseenter', () => { moreBtn.style.color = TEXT_HIGH; });
        moreBtn.addEventListener('mouseleave', () => { moreBtn.style.color = TEXT_MID; });
        moreBtn.addEventListener('click', async () => {
          moreBtn.textContent = '読み込み中...';
          moreBtn.style.cursor = 'default';
          const offset = col.nextOffset ?? col.nodes.length;
          const { nodes: newNodes, hasMore: newHasMore } = await fetchAllNodes(gId, [...state.bookmarks], offset);
          if (state.columns[colIndex]) {
            // Append only nodes not already in the list
            const existingIds = new Set(state.columns[colIndex].nodes.map((n) => n.id));
            const fresh = newNodes.filter((n) => !existingIds.has(n.id));
            state.columns[colIndex].nodes.push(...fresh);
            state.columns[colIndex].hasMore = newHasMore;
            state.columns[colIndex].nextOffset = offset + newNodes.length;
            for (const n of fresh) {
              list.insertBefore(buildNodeRow(n, colIndex), moreBtn);
            }
          }
          if (newHasMore) {
            moreBtn.textContent = 'さらに読み込む';
            moreBtn.style.cursor = 'pointer';
          } else {
            moreBtn.remove();
          }
        });
        list.appendChild(moreBtn);
      }
    }
    colEl.appendChild(list);
    return colEl;
  };

  const getColumnTextareas = (colIndex: number): HTMLTextAreaElement[] => {
    const colEl = columnsEl.children[colIndex];
    if (!colEl) return [];
    return Array.from(colEl.querySelectorAll<HTMLTextAreaElement>('[data-list] textarea[data-node-id]'));
  };

  const buildNodeRow = (node: ExplorerNode, colIndex: number): HTMLElement => {
    const selected = state.columns[colIndex]?.selectedId === node.id;
    const isBookmarked = state.bookmarks.has(node.id);

    const row = document.createElement('div');
    row.dataset.nodeId = node.id;
    row.style.cssText = `
      display:flex;align-items:flex-start;gap:4px;
      padding:1px 8px 1px 8px;flex-shrink:0;
      background:transparent;
      border-left:2px solid ${selected ? SELECT_STRONG : 'transparent'};
    `;

    // Star bookmark (☆ unfilled / ★ filled)
    const star = document.createElement('span');
    star.textContent = isBookmarked ? '★' : '☆';
    star.title = isBookmarked ? 'ブックマーク解除' : 'ブックマーク';
    star.style.cssText = `
      flex-shrink:0;align-self:center;cursor:pointer;font-size:10px;line-height:1;
      color:${isBookmarked ? 'rgba(255,190,60,0.9)' : TEXT_DIM};
      margin-top:1px;user-select:none;
    `;
    star.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const nowBookmarked = !state.bookmarks.has(node.id);
      if (nowBookmarked) {
        state.bookmarks.add(node.id);
        // Inject into col0 nodes if not already present
        if (state.columns[0] && !state.columns[0].nodes.some((n) => n.id === node.id)) {
          state.columns[0].nodes.unshift(node);
        }
      } else {
        state.bookmarks.delete(node.id);
      }
      saveBookmarks(gId, state.bookmarks);
      // Invalidate col0 cache so next full reload reflects bookmark changes
      childrenCache.delete(null);
      // Update this star's appearance
      star.textContent = nowBookmarked ? '★' : '☆';
      star.style.color = nowBookmarked ? 'rgba(255,190,60,0.9)' : TEXT_DIM;
      star.title = nowBookmarked ? 'ブックマーク解除' : 'ブックマーク';
      // Rebuild column 0 to reorder pinned nodes
      if (state.columns[0]) {
        const col0El = columnsEl.children[0] as HTMLElement | undefined;
        if (col0El) columnsEl.replaceChild(buildColumnEl(0), col0El);
      }
    });
    row.appendChild(star);

    // Marker dot (right-click for color picker)
    const marker = document.createElement('span');
    marker.dataset.marker = '1';
    marker.style.cssText = `
      width:6px;height:6px;flex-shrink:0;align-self:center;
      border-radius:1px;box-sizing:border-box;
      background:${node.color ?? 'transparent'};
      border:${node.color ? 'none' : `1.5px solid ${TEXT_DIM}`};
      margin-top:1px;cursor:context-menu;
    `;
    marker.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showColorPicker(marker, node, colIndex);
    });
    row.appendChild(marker);

    // Textarea
    const inp = document.createElement('textarea');
    inp.rows = 1;
    const prim = primaryLabel(node, state.lang);
    inp.value = prim ?? '';
    inp.placeholder = fallbackLabel(node, state.lang);
    inp.dataset.nodeId = node.id;
    Object.assign(inp.style, {
      display: 'block',
      width: '100%',
      border: 'none',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
      padding: '2px 4px',
      boxSizing: 'border-box',
      background: 'transparent',
      color: prim != null ? TEXT_HIGH : TEXT_DIM,
    });
    (inp.style as unknown as Record<string, string>)['field-sizing'] = 'content';

    inp.addEventListener('focus', () => {
      onNodeFocus(colIndex, node.id);
    });

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    inp.addEventListener('input', () => {
      if (state.lang === 'en') node.en = inp.value || undefined;
      else node.ja = inp.value || undefined;
      inp.style.color = inp.value ? TEXT_HIGH : TEXT_DIM;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void apiUpdateNode(gId, node.id, state.lang, inp.value.trim());
      }, 800);
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { inp.blur(); return; }

      // Ctrl+Shift+Backspace → delete node, focus node above
      if (e.key === 'Backspace' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        const textareas = getColumnTextareas(colIndex);
        const myIdx = textareas.indexOf(inp);
        const focusTarget = textareas[myIdx > 0 ? myIdx - 1 : myIdx + 1];
        deleteNode(node, colIndex, focusTarget?.dataset.nodeId);
        return;
      }

      // Shift+Alt+Up/Down → reorder node in column
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && e.altKey) {
        e.preventDefault();
        const col = state.columns[colIndex];
        if (!col) return;
        const idx = col.nodes.indexOf(node);
        if (idx === -1) return;
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= col.nodes.length) return;
        col.nodes.splice(idx, 1);
        col.nodes.splice(newIdx, 0, node);
        const colEl = columnsEl.children[colIndex] as HTMLElement | undefined;
        if (colEl) {
          columnsEl.replaceChild(buildColumnEl(colIndex), colEl);
          const newColEl = columnsEl.children[colIndex] as HTMLElement | undefined;
          const movedInp = newColEl?.querySelector<HTMLTextAreaElement>(`textarea[data-node-id="${node.id}"]`);
          movedInp?.focus();
        }
        return;
      }

      // ArrowUp at start → focus previous node's textarea
      if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        if (inp.selectionStart === 0 && inp.selectionEnd === 0) {
          e.preventDefault();
          const textareas = getColumnTextareas(colIndex);
          const myIdx = textareas.indexOf(inp);
          const prev = textareas[myIdx - 1];
          if (prev) {
            prev.focus();
            requestAnimationFrame(() => {
              prev.setSelectionRange(prev.value.length, prev.value.length);
            });
          }
          return;
        }
      }

      // ArrowDown at end → focus next node's textarea
      if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        if (inp.selectionStart === inp.value.length && inp.selectionEnd === inp.value.length) {
          e.preventDefault();
          const textareas = getColumnTextareas(colIndex);
          const myIdx = textareas.indexOf(inp);
          const next = textareas[myIdx + 1];
          if (next) {
            next.focus();
            requestAnimationFrame(() => {
              next.setSelectionRange(0, 0);
            });
          }
          return;
        }
      }
    });

    row.appendChild(inp);
    return row;
  };

  void loadColumn(null, 0);

  return outer;
}
