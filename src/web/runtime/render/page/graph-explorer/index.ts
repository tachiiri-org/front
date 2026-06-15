import type { GraphExplorerComponent } from '../../../../schema/component/kind/graph-explorer';

type ExplorerNode = { id: string; en?: string; ja?: string; color?: string };

type ExplorerColumn = {
  parentId: string;
  nodes: ExplorerNode[];
  loading: boolean;
  selectedId: string | null;
};

type ExplorerState = {
  graphId: string;
  lang: 'en' | 'ja';
  limit: number;
  columns: ExplorerColumn[];
};

const BG = '#1e1e1e';
const BORDER = '#333';
const TEXT_HIGH = '#e0e0e0';
const TEXT_MID = '#aaa';
const TEXT_DIM = '#555';
const SELECT_STRONG = '#3a6ea8';
const SELECT_SUBTLE = '#1e2f42';

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

async function fetchChildren(graphId: string, nodeId: string, limit: number): Promise<ExplorerNode[]> {
  const r = await apiFetch(`/api/graph/${graphId}/node/${nodeId}/children?limit=${limit}`);
  if (!r.ok) return [];
  const data = await r.json() as { nodes: ExplorerNode[] };
  return data.nodes ?? [];
}

async function apiCreateNode(
  graphId: string, parentId: string, lang: 'en' | 'ja', label: string,
): Promise<ExplorerNode | null> {
  const body = lang === 'en' ? { parentId, en: label } : { parentId, ja: label };
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

async function apiDeleteNode(graphId: string, nodeId: string): Promise<void> {
  await apiFetch(`/api/graph/${graphId}/node/${nodeId}`, { method: 'DELETE' });
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
  };

  // Track pending column loads to avoid races
  let columnVersion = 0;

  const outer = document.createElement('div');
  outer.id = id;
  outer.style.cssText = `display:flex;flex-direction:column;height:100%;background:${BG};color:${TEXT_HIGH};font-family:sans-serif;font-size:13px;line-height:1.5;overflow:hidden;`;

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
  };
  jaBtn.addEventListener('click', () => switchLang('ja'));
  enBtn.addEventListener('click', () => switchLang('en'));
  topBar.appendChild(jaBtn);
  topBar.appendChild(enBtn);
  outer.appendChild(topBar);

  // ── Columns area ──────────────────────────────────────────────────
  const columnsEl = document.createElement('div');
  columnsEl.style.cssText = `display:flex;flex:1;overflow-x:auto;overflow-y:hidden;`;
  outer.appendChild(columnsEl);

  // Rebuild all column DOM from current state
  const rebuildAll = () => {
    columnsEl.innerHTML = '';
    for (let i = 0; i < state.columns.length; i++) {
      columnsEl.appendChild(buildColumnEl(i));
    }
  };

  // Append or update a single column (used when a new column is added)
  const appendColumn = (colIndex: number) => {
    // Remove columns at or beyond colIndex
    const existing = columnsEl.children;
    while (existing.length > colIndex) {
      columnsEl.removeChild(existing[existing.length - 1]);
    }
    columnsEl.appendChild(buildColumnEl(colIndex));
  };

  const loadColumn = async (parentId: string, colIndex: number) => {
    const version = ++columnVersion;
    state.columns = state.columns.slice(0, colIndex);
    state.columns.push({ parentId, nodes: [], loading: true, selectedId: null });
    appendColumn(colIndex);

    const nodes = await fetchChildren(gId, parentId, limit);
    if (version !== columnVersion) return; // superseded
    if (state.columns[colIndex]) {
      state.columns[colIndex].nodes = nodes;
      state.columns[colIndex].loading = false;
    }
    // Replace the loading column with the loaded one
    const colEl = columnsEl.children[colIndex] as HTMLElement | undefined;
    if (colEl) {
      columnsEl.replaceChild(buildColumnEl(colIndex), colEl);
    }
  };

  const onNodeFocus = (colIndex: number, nodeId: string) => {
    if (state.columns[colIndex]?.selectedId === nodeId) return;
    if (state.columns[colIndex]) state.columns[colIndex].selectedId = nodeId;
    void loadColumn(nodeId, colIndex + 1);
    // Highlight the selected row
    refreshRowStyles(colIndex);
  };

  const refreshRowStyles = (colIndex: number) => {
    const colEl = columnsEl.children[colIndex];
    if (!colEl) return;
    const selectedId = state.columns[colIndex]?.selectedId;
    colEl.querySelectorAll<HTMLElement>('[data-node-id]').forEach((row) => {
      const isSelected = row.dataset.nodeId === selectedId;
      row.style.background = isSelected ? SELECT_SUBTLE : 'transparent';
      row.style.borderLeft = `2px solid ${isSelected ? SELECT_STRONG : 'transparent'}`;
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

    // ── Header ────────────────────────────────────────────────────
    const header = document.createElement('div');
    if (colIndex === 0) {
      header.textContent = 'ルート';
    } else {
      const prevCol = state.columns[colIndex - 1];
      const parentNode = prevCol?.nodes.find((n) => n.id === col.parentId);
      if (parentNode) {
        header.textContent = primaryLabel(parentNode, state.lang) ?? fallbackLabel(parentNode, state.lang);
      } else {
        header.textContent = col.parentId.slice(0, 8);
      }
    }
    header.title = col.parentId;
    header.style.cssText = `
      padding:6px 12px;font-size:11px;font-weight:600;
      color:${TEXT_DIM};letter-spacing:0.05em;text-transform:uppercase;
      border-bottom:1px solid ${BORDER};
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;
    `;
    colEl.appendChild(header);

    // ── New node input (top, like word-col draft) ─────────────────
    const draftRow = document.createElement('div');
    draftRow.style.cssText = `display:flex;align-items:flex-start;gap:4px;padding:1px 8px 1px 12px;flex-shrink:0;`;

    const draftMarker = document.createElement('span');
    draftMarker.style.cssText = `
      width:6px;height:6px;flex-shrink:0;align-self:center;
      border-radius:1px;box-sizing:border-box;
      background:transparent;border:1.5px solid ${TEXT_DIM};
      margin-top:1px;
    `;

    const draftInput = document.createElement('textarea');
    draftInput.rows = 1;
    draftInput.placeholder = '新しいノード';
    Object.assign(draftInput.style, {
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
      color: TEXT_MID,
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
      const newNode = await apiCreateNode(gId, col.parentId, state.lang, val);
      if (newNode && state.columns[colIndex]) {
        state.columns[colIndex].nodes.push(newNode);
        // Append the new row into the list
        const listEl = colEl.querySelector<HTMLElement>('[data-list]');
        if (listEl) listEl.appendChild(buildNodeRow(newNode, colIndex));
        void onNodeFocus(colIndex, newNode.id);
      }
    });

    draftRow.appendChild(draftMarker);
    draftRow.appendChild(draftInput);
    colEl.appendChild(draftRow);

    // ── Item list ─────────────────────────────────────────────────
    const list = document.createElement('div');
    list.dataset.list = '1';
    list.style.cssText = `flex:1;overflow-y:auto;padding:4px 0;`;

    if (col.loading) {
      const msg = document.createElement('div');
      msg.textContent = '読み込み中...';
      msg.style.cssText = `padding:4px 12px;color:${TEXT_DIM};font-size:13px;`;
      list.appendChild(msg);
    } else if (col.nodes.length === 0) {
      const msg = document.createElement('div');
      msg.textContent = 'ノードなし';
      msg.style.cssText = `padding:4px 12px;color:${TEXT_DIM};font-size:13px;`;
      list.appendChild(msg);
    } else {
      for (const node of col.nodes) {
        list.appendChild(buildNodeRow(node, colIndex));
      }
    }
    colEl.appendChild(list);
    return colEl;
  };

  const buildNodeRow = (node: ExplorerNode, colIndex: number): HTMLElement => {
    const selected = state.columns[colIndex]?.selectedId === node.id;

    const row = document.createElement('div');
    row.dataset.nodeId = node.id;
    row.style.cssText = `
      display:flex;align-items:flex-start;gap:4px;
      padding:1px 8px 1px 12px;flex-shrink:0;
      background:${selected ? SELECT_SUBTLE : 'transparent'};
      border-left:2px solid ${selected ? SELECT_STRONG : 'transparent'};
    `;

    // Marker dot
    const marker = document.createElement('span');
    marker.style.cssText = `
      width:6px;height:6px;flex-shrink:0;align-self:center;
      border-radius:1px;box-sizing:border-box;
      background:${node.color ?? 'transparent'};
      border:${node.color ? 'none' : `1.5px solid ${TEXT_DIM}`};
      margin-top:1px;
    `;
    row.appendChild(marker);

    // Textarea (always editable, like word-col)
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
      // Update in-memory label immediately
      if (state.lang === 'en') node.en = inp.value || undefined;
      else node.ja = inp.value || undefined;
      inp.style.color = inp.value ? TEXT_HIGH : TEXT_DIM;
      // Debounce API save
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void apiUpdateNode(gId, node.id, state.lang, inp.value.trim());
      }, 800);
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { inp.blur(); }
    });

    row.appendChild(inp);

    // Delete button (shown on hover)
    const delBtn = document.createElement('button');
    delBtn.textContent = '×';
    delBtn.title = '削除';
    delBtn.style.cssText = `
      display:none;background:none;border:none;color:${TEXT_DIM};
      cursor:pointer;font-size:13px;padding:0 2px;line-height:1.5;flex-shrink:0;align-self:center;
    `;
    delBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (!confirm('このノードを削除しますか？')) return;
      void apiDeleteNode(gId, node.id).then(() => {
        if (state.columns[colIndex]) {
          state.columns[colIndex].nodes = state.columns[colIndex].nodes.filter((n) => n.id !== node.id);
          if (state.columns[colIndex].selectedId === node.id) {
            state.columns[colIndex].selectedId = null;
            state.columns = state.columns.slice(0, colIndex + 1);
          }
        }
        rebuildAll();
      });
    });
    row.appendChild(delBtn);

    row.addEventListener('mouseenter', () => { delBtn.style.display = 'block'; });
    row.addEventListener('mouseleave', () => { delBtn.style.display = 'none'; });

    return row;
  };

  void loadColumn(gId, 0);

  return outer;
}
