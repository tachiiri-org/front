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
  editingId: string | null;
};

const BG = '#1e1e1e';
const BORDER = '#333';
const TEXT_HIGH = '#e0e0e0';
const TEXT_MID = '#aaa';
const TEXT_DIM = '#555';
const SELECT_STRONG = '#3a6ea8';
const SELECT_SUBTLE = '#1e2f42';
const COL_WIDTH = 260;

function getLabel(node: ExplorerNode, lang: 'en' | 'ja'): string {
  if (lang === 'en') return node.en || node.ja || node.id.slice(0, 8);
  return node.ja || node.en || node.id.slice(0, 8);
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(input, init);
  if (r.status === 401) { window.location.href = '/login'; }
  return r;
}

async function fetchChildren(graphId: string, nodeId: string, limit: number): Promise<ExplorerNode[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/children?limit=${limit}`);
  if (!r.ok) return [];
  const data = await r.json() as { nodes: ExplorerNode[] };
  return data.nodes ?? [];
}

async function apiCreateNode(
  graphId: string, parentId: string, lang: 'en' | 'ja', label: string,
): Promise<ExplorerNode | null> {
  const body = lang === 'en' ? { parentId, en: label } : { parentId, ja: label };
  const r = await apiFetch(`/api/v1/graph/${graphId}/node`, {
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
  await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function apiDeleteNode(graphId: string, nodeId: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}`, { method: 'DELETE' });
}

export function renderGraphExplorer(
  id: string,
  comp: GraphExplorerComponent,
  graphId?: string,
): HTMLElement {
  const gId = graphId ?? comp.graphId;
  const lang: 'en' | 'ja' = comp.lang ?? 'ja';
  const limit = typeof comp.limit === 'number' && comp.limit > 0 ? comp.limit : 100;

  const state: ExplorerState = {
    graphId: gId,
    lang,
    limit,
    columns: [],
    editingId: null,
  };

  const outer = document.createElement('div');
  outer.id = id;
  outer.style.cssText = `display:flex;flex-direction:column;height:100%;background:${BG};color:${TEXT_HIGH};font-family:sans-serif;font-size:14px;overflow:hidden;`;

  const columnsEl = document.createElement('div');
  columnsEl.style.cssText = `display:flex;flex:1;overflow-x:auto;overflow-y:hidden;`;
  outer.appendChild(columnsEl);

  const render = () => {
    columnsEl.innerHTML = '';
    for (let i = 0; i < state.columns.length; i++) {
      columnsEl.appendChild(buildColumn(i));
    }
  };

  const loadColumn = async (parentId: string, colIndex: number) => {
    state.columns = state.columns.slice(0, colIndex);
    state.columns.push({ parentId, nodes: [], loading: true, selectedId: null });
    render();
    const nodes = await fetchChildren(gId, parentId, limit);
    if (state.columns[colIndex]) {
      state.columns[colIndex].nodes = nodes;
      state.columns[colIndex].loading = false;
    }
    render();
  };

  const selectNode = (colIndex: number, nodeId: string) => {
    if (state.columns[colIndex]) {
      state.columns[colIndex].selectedId = nodeId;
    }
    loadColumn(nodeId, colIndex + 1);
  };

  const deleteNode = async (colIndex: number, nodeId: string) => {
    if (!confirm('このノードを削除しますか？')) return;
    await apiDeleteNode(gId, nodeId);
    if (state.columns[colIndex]) {
      state.columns[colIndex].nodes = state.columns[colIndex].nodes.filter((n) => n.id !== nodeId);
      if (state.columns[colIndex].selectedId === nodeId) {
        state.columns[colIndex].selectedId = null;
        state.columns = state.columns.slice(0, colIndex + 1);
      }
    }
    render();
  };

  const buildColumn = (colIndex: number): HTMLElement => {
    const col = state.columns[colIndex];

    const colEl = document.createElement('div');
    colEl.style.cssText = `
      min-width:${COL_WIDTH}px;width:${COL_WIDTH}px;
      display:flex;flex-direction:column;
      border-right:1px solid ${BORDER};
      flex-shrink:0;
      overflow:hidden;
    `;

    // Header: show parent node label
    const header = document.createElement('div');
    if (colIndex === 0) {
      header.textContent = 'ルート';
    } else {
      const prevCol = state.columns[colIndex - 1];
      const parentNode = prevCol?.nodes.find((n) => n.id === col.parentId);
      header.textContent = parentNode ? getLabel(parentNode, lang) : col.parentId.slice(0, 8);
    }
    header.title = col.parentId;
    header.style.cssText = `
      padding:8px 12px;
      font-size:11px;
      font-weight:600;
      color:${TEXT_DIM};
      letter-spacing:0.05em;
      text-transform:uppercase;
      border-bottom:1px solid ${BORDER};
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      flex-shrink:0;
    `;
    colEl.appendChild(header);

    // Item list
    const list = document.createElement('div');
    list.style.cssText = `flex:1;overflow-y:auto;`;

    if (col.loading) {
      const loading = document.createElement('div');
      loading.textContent = '読み込み中...';
      loading.style.cssText = `padding:12px;color:${TEXT_DIM};font-size:13px;`;
      list.appendChild(loading);
    } else if (col.nodes.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'ノードなし';
      empty.style.cssText = `padding:12px;color:${TEXT_DIM};font-size:13px;`;
      list.appendChild(empty);
    } else {
      for (const node of col.nodes) {
        list.appendChild(buildItem(node, colIndex, col.selectedId === node.id));
      }
    }
    colEl.appendChild(list);

    // Footer: new node input
    colEl.appendChild(buildNewNodeInput(colIndex, col.parentId));

    return colEl;
  };

  const buildItem = (node: ExplorerNode, colIndex: number, selected: boolean): HTMLElement => {
    const item = document.createElement('div');
    item.dataset.nodeId = node.id;
    item.style.cssText = `
      display:flex;align-items:center;gap:6px;
      padding:7px 10px 7px 12px;
      cursor:pointer;
      background:${selected ? SELECT_SUBTLE : 'transparent'};
      border-left:2px solid ${selected ? SELECT_STRONG : 'transparent'};
    `;

    const onHoverIn = () => { if (!selected) item.style.background = '#242424'; };
    const onHoverOut = () => { item.style.background = selected ? SELECT_SUBTLE : 'transparent'; };
    item.addEventListener('mouseenter', onHoverIn);
    item.addEventListener('mouseleave', onHoverOut);

    if (state.editingId === node.id) {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = getLabel(node, lang);
      input.style.cssText = `
        flex:1;background:transparent;border:none;
        border-bottom:1px solid ${SELECT_STRONG};
        color:${TEXT_HIGH};font-size:14px;outline:none;padding:0;
      `;
      let saved = false;
      const save = async () => {
        if (saved) return;
        saved = true;
        const val = input.value.trim();
        if (val) {
          await apiUpdateNode(gId, node.id, lang, val);
          if (lang === 'en') node.en = val; else node.ja = val;
        }
        state.editingId = null;
        render();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); void save(); }
        if (e.key === 'Escape') { state.editingId = null; render(); }
      });
      input.addEventListener('blur', () => { void save(); });
      item.appendChild(input);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    } else {
      // Color dot if any
      if (node.color) {
        const dot = document.createElement('span');
        dot.style.cssText = `
          width:8px;height:8px;border-radius:50%;
          background:${node.color};flex-shrink:0;
        `;
        item.appendChild(dot);
      }

      const label = document.createElement('span');
      label.textContent = getLabel(node, lang);
      label.style.cssText = `flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      item.appendChild(label);

      // Delete button (visible on hover)
      const delBtn = document.createElement('button');
      delBtn.textContent = '×';
      delBtn.title = '削除';
      delBtn.style.cssText = `
        display:none;background:none;border:none;color:${TEXT_DIM};
        cursor:pointer;font-size:14px;padding:0 2px;line-height:1;flex-shrink:0;
      `;
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); void deleteNode(colIndex, node.id); });
      item.appendChild(delBtn);

      // Arrow: shows when selected
      const arrow = document.createElement('span');
      arrow.textContent = '›';
      arrow.style.cssText = `
        color:${selected ? SELECT_STRONG : TEXT_DIM};
        font-size:16px;line-height:1;flex-shrink:0;
        ${selected ? '' : 'opacity:0.4;'}
      `;
      item.appendChild(arrow);

      item.addEventListener('mouseenter', () => { delBtn.style.display = 'block'; });
      item.addEventListener('mouseleave', () => { delBtn.style.display = 'none'; });
    }

    item.addEventListener('click', () => {
      if (state.editingId === node.id) return;
      selectNode(colIndex, node.id);
    });
    item.addEventListener('dblclick', () => {
      state.editingId = node.id;
      render();
    });

    return item;
  };

  const buildNewNodeInput = (colIndex: number, parentId: string): HTMLElement => {
    const footer = document.createElement('div');
    footer.style.cssText = `border-top:1px solid ${BORDER};padding:8px 12px;flex-shrink:0;`;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '+ 新しいノード';
    input.style.cssText = `
      width:100%;box-sizing:border-box;
      background:transparent;border:none;
      border-bottom:1px solid transparent;
      color:${TEXT_MID};font-size:13px;outline:none;padding:2px 0;
    `;
    input.addEventListener('focus', () => {
      input.style.borderBottomColor = SELECT_STRONG;
      input.style.color = TEXT_HIGH;
    });
    input.addEventListener('blur', () => {
      input.style.borderBottomColor = 'transparent';
      input.style.color = TEXT_MID;
    });
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      input.value = '';
      const newNode = await apiCreateNode(gId, parentId, lang, val);
      if (newNode && state.columns[colIndex]) {
        state.columns[colIndex].nodes.push(newNode);
        render();
        selectNode(colIndex, newNode.id);
      }
    });

    footer.appendChild(input);
    return footer;
  };

  // Initial load: root column shows children of the graph node
  void loadColumn(gId, 0);

  return outer;
}
