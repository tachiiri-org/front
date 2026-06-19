import type { StorageExplorerComponent } from '../../../../schema/component/kind/storage-explorer';
import { ALL_CSS_PROP_KEYS } from '../../../../schema/component/style';

const C = {
  bg: '#0f172a',
  surface: '#1e293b',
  border: '#334155',
  text: '#cbd5e1',
  textBright: '#f1f5f9',
  textDim: '#64748b',
  accent: '#3b82f6',
  hoverBg: '#1e3a5f',
  selectedBg: '#1e3a8a',
};

function styled<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles?: Partial<CSSStyleDeclaration>,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  return e;
}

type D1DatabaseEntry = { uuid: string; name: string };
type D1ListResponse = { result: D1DatabaseEntry[]; success: boolean };
type D1QueryRow = Record<string, unknown>;
type D1QueryResponse = { result: [{ results: D1QueryRow[] }]; success: boolean };

type R2Bucket = { name: string; creation_date: string };
type R2BucketsResponse = { buckets: R2Bucket[] };
type R2FileEntry = { key: string; size: number; uploaded?: string };
type R2FilesResponse = {
  objects: R2FileEntry[];
  delimited_prefixes: string[];
  cursor: string | null;
  is_truncated: boolean;
};
type R2FileResponse = {
  key: string;
  content_base64: string;
  etag?: string;
  size?: number;
  uploaded?: string;
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const decodeBase64 = (b64: string): string | null => {
  try {
    const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
};

export const renderStorageExplorer = (
  id: string,
  component: StorageExplorerComponent,
): HTMLElement => {
  const root = styled('div', {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    background: C.bg,
    color: C.text,
    fontFamily: 'monospace',
    fontSize: '13px',
    boxSizing: 'border-box',
    overflow: 'hidden',
  });
  root.dataset.frameId = id;

  for (const propKey of ALL_CSS_PROP_KEYS) {
    const v = (component as Record<string, unknown>)[propKey];
    if (typeof v === 'string') (root.style as unknown as Record<string, string>)[propKey] = v;
  }

  // --- Tab bar ---
  const tabBar = styled('div', {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '6px 12px 0',
    background: C.surface,
    borderBottom: `1px solid ${C.border}`,
    flexShrink: '0',
  });

  const makeTab = (label: string): HTMLButtonElement => {
    const btn = styled('button', {
      padding: '4px 16px',
      fontSize: '12px',
      fontFamily: 'monospace',
      cursor: 'pointer',
      border: 'none',
      borderRadius: '4px 4px 0 0',
      background: 'transparent',
      color: C.textDim,
    });
    btn.textContent = label;
    return btn;
  };

  const d1Tab = makeTab('D1');
  const r2Tab = makeTab('R2');
  tabBar.append(d1Tab, r2Tab);
  root.appendChild(tabBar);

  // --- Body ---
  const body = styled('div', {
    display: 'flex',
    flex: '1',
    minHeight: '0',
    overflow: 'hidden',
  });
  root.appendChild(body);

  // --- Sidebar ---
  const sidebar = styled('div', {
    width: '240px',
    flexShrink: '0',
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${C.border}`,
    background: C.surface,
    overflow: 'hidden',
  });

  const sidebarTop = styled('div', {
    padding: '8px',
    flexShrink: '0',
    borderBottom: `1px solid ${C.border}`,
  });

  const sourceSelect = styled('select', {
    width: '100%',
    background: C.bg,
    color: C.text,
    border: `1px solid ${C.border}`,
    padding: '4px 6px',
    fontSize: '12px',
    fontFamily: 'monospace',
    borderRadius: '3px',
    cursor: 'pointer',
    boxSizing: 'border-box',
  });

  const placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = '-- 読み込み中 --';
  placeholderOpt.disabled = true;
  placeholderOpt.selected = true;
  sourceSelect.appendChild(placeholderOpt);
  sidebarTop.appendChild(sourceSelect);
  sidebar.appendChild(sidebarTop);

  const sidebarList = styled('div', {
    flex: '1',
    overflowY: 'auto',
    padding: '4px 0',
  });
  sidebar.appendChild(sidebarList);
  body.appendChild(sidebar);

  // --- Main ---
  const main = styled('div', {
    flex: '1',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: C.bg,
  });

  const mainHeader = styled('div', {
    padding: '5px 12px',
    flexShrink: '0',
    borderBottom: `1px solid ${C.border}`,
    background: C.surface,
    color: C.textDim,
    fontSize: '11px',
    minHeight: '28px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
  });

  const mainContent = styled('div', {
    flex: '1',
    overflow: 'auto',
  });

  main.append(mainHeader, mainContent);
  body.appendChild(main);

  // --- Shared helpers ---

  const showMessage = (msg: string): void => {
    mainContent.replaceChildren();
    mainHeader.replaceChildren();
    if (!msg) return;
    const p = styled('div', { padding: '16px', color: C.textDim, fontSize: '12px' });
    p.textContent = msg;
    mainContent.appendChild(p);
  };

  const makeTableHeader = (labels: string[]): HTMLTableSectionElement => {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const label of labels) {
      const th = styled('th', {
        padding: '5px 8px',
        textAlign: 'left',
        borderBottom: `1px solid ${C.border}`,
        color: C.textDim,
        fontWeight: '600',
        fontSize: '11px',
        position: 'sticky',
        top: '0',
        background: C.surface,
        whiteSpace: 'nowrap',
      });
      th.textContent = label;
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    return thead;
  };

  // ================================================================
  // D1
  // ================================================================

  const D1_LIMIT = 100;

  // D1 sidebar uses simple list items (not tree)
  let d1SelectedRow: HTMLElement | null = null;
  const selectD1Row = (row: HTMLElement): void => {
    if (d1SelectedRow) { d1SelectedRow.style.background = ''; delete d1SelectedRow.dataset.selected; }
    d1SelectedRow = row;
    row.dataset.selected = '1';
    row.style.background = C.selectedBg;
  };

  const makeD1SidebarItem = (label: string, onClick: () => void): HTMLElement => {
    const item = styled('div', {
      padding: '4px 12px',
      cursor: 'pointer',
      fontSize: '12px',
      color: C.text,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    item.title = label;
    item.textContent = label;
    item.addEventListener('mouseenter', () => { if (!item.dataset.selected) item.style.background = C.hoverBg; });
    item.addEventListener('mouseleave', () => { if (!item.dataset.selected) item.style.background = ''; });
    item.addEventListener('click', () => { selectD1Row(item); onClick(); });
    return item;
  };

  const loadD1Databases = async (): Promise<void> => {
    showMessage('データベースを読み込み中...');
    try {
      const res = await fetch('/api/v1/viewer/d1/databases');
      if (!res.ok) { showMessage(`エラー: ${res.status}`); return; }
      const data = (await res.json()) as D1ListResponse;
      const dbs = Array.isArray(data.result) ? data.result : [];

      sourceSelect.replaceChildren();
      if (dbs.length === 0) { showMessage('データベースが見つかりません'); return; }

      for (const db of dbs) {
        const opt = document.createElement('option');
        opt.value = db.uuid;
        opt.textContent = db.name;
        sourceSelect.appendChild(opt);
      }
      // Auto-select first
      sourceSelect.value = dbs[0].uuid;
      void loadD1Tables(dbs[0].uuid);
    } catch {
      showMessage('データベースの取得に失敗しました');
    }
  };

  const loadD1Tables = async (dbId: string): Promise<void> => {
    sidebarList.replaceChildren();
    d1SelectedRow = null;
    showMessage('テーブルを読み込み中...');
    try {
      const res = await fetch(`/api/v1/viewer/d1/${encodeURIComponent(dbId)}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" }),
      });
      if (!res.ok) { showMessage(`エラー: ${res.status}`); return; }
      const data = (await res.json()) as D1QueryResponse;
      const rows = data.result?.[0]?.results ?? [];

      if (rows.length === 0) { showMessage('テーブルがありません'); return; }
      showMessage('テーブルを選択してください');
      for (const row of rows) {
        const name = String(row.name ?? '');
        sidebarList.appendChild(makeD1SidebarItem(name, () => loadD1TableData(dbId, name)));
      }
    } catch {
      showMessage('テーブル一覧の取得に失敗しました');
    }
  };

  const loadD1TableData = async (dbId: string, tableName: string, offset = 0): Promise<void> => {
    mainContent.replaceChildren();
    mainHeader.replaceChildren();

    const info = styled('span', { color: C.textDim });
    info.textContent = `${tableName} — 読み込み中...`;
    mainHeader.appendChild(info);

    try {
      const res = await fetch(`/api/v1/viewer/d1/${encodeURIComponent(dbId)}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: `SELECT * FROM "${tableName}" LIMIT ${D1_LIMIT} OFFSET ${offset}` }),
      });
      if (!res.ok) { showMessage(`エラー: ${res.status}`); return; }
      const data = (await res.json()) as D1QueryResponse;
      const rows = data.result?.[0]?.results ?? [];

      mainHeader.replaceChildren();

      if (offset > 0) {
        const prev = styled('button', {
          fontSize: '11px', padding: '1px 8px', cursor: 'pointer',
          background: C.surface, color: C.text, border: `1px solid ${C.border}`,
          borderRadius: '3px', fontFamily: 'monospace',
        });
        prev.textContent = '← 前';
        prev.addEventListener('click', () => loadD1TableData(dbId, tableName, offset - D1_LIMIT));
        mainHeader.appendChild(prev);
      }

      const label = styled('span', { color: C.textDim });
      label.textContent = `${tableName}  offset: ${offset}  rows: ${rows.length}`;
      mainHeader.appendChild(label);

      if (rows.length === D1_LIMIT) {
        const next = styled('button', {
          fontSize: '11px', padding: '1px 8px', cursor: 'pointer',
          background: C.surface, color: C.text, border: `1px solid ${C.border}`,
          borderRadius: '3px', fontFamily: 'monospace',
        });
        next.textContent = '次 →';
        next.addEventListener('click', () => loadD1TableData(dbId, tableName, offset + D1_LIMIT));
        mainHeader.appendChild(next);
      }

      if (rows.length > 0) {
        const copyBtn = styled('button', {
          fontSize: '11px', padding: '1px 8px', cursor: 'pointer',
          background: C.surface, color: C.text, border: `1px solid ${C.border}`,
          borderRadius: '3px', fontFamily: 'monospace', marginLeft: 'auto',
        });
        copyBtn.textContent = 'コピー';
        copyBtn.addEventListener('click', () => {
          const cols = Object.keys(rows[0]);
          const tsv = [cols.join('\t'), ...rows.map((r) => cols.map((c) => (r[c] === null || r[c] === undefined ? '' : String(r[c]))).join('\t'))].join('\n');
          navigator.clipboard.writeText(tsv).then(() => {
            copyBtn.textContent = '✓ コピー済';
            setTimeout(() => { copyBtn.textContent = 'コピー'; }, 1500);
          }).catch(() => { copyBtn.textContent = '失敗'; });
        });
        mainHeader.appendChild(copyBtn);
      }

      if (rows.length === 0) {
        const empty = styled('div', { padding: '16px', color: C.textDim });
        empty.textContent = 'データがありません';
        mainContent.appendChild(empty);
        return;
      }

      const columns = Object.keys(rows[0]);
      const table = styled('table', { width: '100%', borderCollapse: 'collapse', fontSize: '12px' });
      table.appendChild(makeTableHeader(columns));

      const tbody = document.createElement('tbody');
      for (const row of rows) {
        const tr = document.createElement('tr');
        tr.addEventListener('mouseenter', () => { tr.style.background = C.hoverBg; });
        tr.addEventListener('mouseleave', () => { tr.style.background = ''; });
        for (const col of columns) {
          const td = styled('td', {
            padding: '4px 8px',
            borderBottom: `1px solid ${C.border}`,
            maxWidth: '300px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: C.text,
          });
          const val = row[col];
          td.textContent = val === null || val === undefined ? '' : String(val);
          if (val === null) td.style.color = C.textDim;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      mainContent.appendChild(table);
    } catch {
      showMessage('データの取得に失敗しました');
    }
  };

  // ================================================================
  // R2 — VS Code style tree
  // ================================================================

  let r2SelectedRow: HTMLElement | null = null;
  const selectR2Row = (row: HTMLElement): void => {
    if (r2SelectedRow) { r2SelectedRow.style.background = ''; delete r2SelectedRow.dataset.selected; }
    r2SelectedRow = row;
    row.dataset.selected = '1';
    row.style.background = C.selectedBg;
  };

  const loadR2FileContent = async (bucketId: string, key: string): Promise<void> => {
    mainContent.replaceChildren();
    mainHeader.replaceChildren();
    const keyLabel = styled('span', { color: C.textDim });
    keyLabel.textContent = key;
    mainHeader.appendChild(keyLabel);

    const loading = styled('div', { padding: '16px', color: C.textDim });
    loading.textContent = 'ファイルを読み込み中...';
    mainContent.appendChild(loading);

    try {
      const res = await fetch('/api/v1/viewer/r2/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket_id: bucketId, key }),
      });
      if (!res.ok) { showMessage(`エラー: ${res.status}`); return; }
      const data = (await res.json()) as R2FileResponse;
      mainContent.replaceChildren();

      const meta = styled('div', {
        padding: '6px 12px',
        borderBottom: `1px solid ${C.border}`,
        fontSize: '11px',
        color: C.textDim,
        background: C.surface,
      });
      meta.textContent = [
        `size: ${formatSize(data.size ?? 0)}`,
        `etag: ${data.etag ?? '-'}`,
        `uploaded: ${data.uploaded ? new Date(data.uploaded).toLocaleString('ja-JP') : '-'}`,
      ].join('   |   ');
      mainContent.appendChild(meta);

      const text = decodeBase64(data.content_base64);
      if (text !== null) {
        let display = text;
        if (key.endsWith('.json')) {
          try { display = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
        }
        const pre = styled('pre', {
          margin: '0',
          padding: '12px',
          fontSize: '12px',
          color: C.text,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        });
        pre.textContent = display;
        mainContent.appendChild(pre);
      } else {
        const bin = styled('div', { padding: '16px', color: C.textDim });
        bin.textContent = 'バイナリファイルのため表示できません';
        mainContent.appendChild(bin);
      }
    } catch {
      showMessage('ファイルの取得に失敗しました');
    }
  };

  const fetchR2Children = async (
    bucketId: string,
    prefix: string,
  ): Promise<{ folders: string[]; files: R2FileEntry[] }> => {
    const res = await fetch('/api/v1/viewer/r2/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket_id: bucketId, prefix, delimiter: '/' }),
    });
    if (!res.ok) return { folders: [], files: [] };
    const data = (await res.json()) as R2FilesResponse;
    return { folders: data.delimited_prefixes ?? [], files: data.objects ?? [] };
  };

  const makeR2TreeNode = (
    bucketId: string,
    fullPrefix: string,
    name: string,
    isFolder: boolean,
    depth: number,
  ): HTMLElement => {
    const wrapper = document.createElement('div');

    const row = styled('div', {
      display: 'flex',
      alignItems: 'center',
      padding: '3px 8px',
      paddingLeft: `${depth * 14 + 6}px`,
      cursor: 'pointer',
      fontSize: '12px',
      color: C.text,
      userSelect: 'none',
      gap: '3px',
    });

    const arrow = styled('span', {
      width: '12px',
      flexShrink: '0',
      fontSize: '9px',
      color: C.textDim,
      textAlign: 'center',
    });
    arrow.textContent = isFolder ? '▶' : '';

    const icon = styled('span', { fontSize: '11px', flexShrink: '0' });
    icon.textContent = isFolder ? '📁' : '📄';

    const label = styled('span', {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      flex: '1',
    });
    label.textContent = name;
    label.title = name;

    row.append(arrow, icon, label);
    row.addEventListener('mouseenter', () => { if (!row.dataset.selected) row.style.background = C.hoverBg; });
    row.addEventListener('mouseleave', () => { if (!row.dataset.selected) row.style.background = ''; });
    wrapper.appendChild(row);

    if (!isFolder) {
      row.addEventListener('click', () => {
        selectR2Row(row);
        void loadR2FileContent(bucketId, fullPrefix + name);
      });
      return wrapper;
    }

    // Folder: expand/collapse children
    const childrenEl = styled('div', { display: 'none' });
    wrapper.appendChild(childrenEl);

    let expanded = false;
    let loaded = false;

    const expand = async (): Promise<void> => {
      if (!loaded) {
        loaded = true;
        const childPrefix = fullPrefix + name + '/';
        try {
          const { folders, files } = await fetchR2Children(bucketId, childPrefix);
          for (const fp of folders) {
            const childName = fp.slice(childPrefix.length).replace(/\/$/, '');
            childrenEl.appendChild(makeR2TreeNode(bucketId, childPrefix, childName, true, depth + 1));
          }
          for (const file of files) {
            const fileName = file.key.slice(childPrefix.length);
            if (fileName) childrenEl.appendChild(makeR2TreeNode(bucketId, childPrefix, fileName, false, depth + 1));
          }
        } catch { /* ignore */ }
      }
      childrenEl.style.display = '';
      arrow.textContent = '▼';
      icon.textContent = '📂';
      expanded = true;
    };

    const collapse = (): void => {
      childrenEl.style.display = 'none';
      arrow.textContent = '▶';
      icon.textContent = '📁';
      expanded = false;
    };

    row.addEventListener('click', () => {
      selectR2Row(row);
      if (expanded) collapse();
      else void expand();
    });

    return wrapper;
  };

  const loadR2Tree = async (bucketId: string): Promise<void> => {
    sidebarList.replaceChildren();
    r2SelectedRow = null;
    showMessage('読み込み中...');
    try {
      const { folders, files } = await fetchR2Children(bucketId, '');
      mainHeader.replaceChildren();
      mainContent.replaceChildren();
      if (folders.length === 0 && files.length === 0) {
        showMessage('バケットが空です');
        return;
      }
      for (const fp of folders) {
        const name = fp.replace(/\/$/, '');
        sidebarList.appendChild(makeR2TreeNode(bucketId, '', name, true, 0));
      }
      for (const file of files) {
        if (file.key) sidebarList.appendChild(makeR2TreeNode(bucketId, '', file.key, false, 0));
      }
      const hint = styled('div', { padding: '16px', color: C.textDim, fontSize: '12px' });
      hint.textContent = 'ファイルを選択してください';
      mainContent.appendChild(hint);
    } catch {
      showMessage('バケットの読み込みに失敗しました');
    }
  };

  const loadR2Buckets = async (): Promise<void> => {
    showMessage('バケットを読み込み中...');
    try {
      const res = await fetch('/api/v1/viewer/r2/buckets');
      if (!res.ok) { showMessage(`エラー: ${res.status}`); return; }
      const data = (await res.json()) as R2BucketsResponse;
      const buckets = Array.isArray(data.buckets) ? data.buckets : [];

      sourceSelect.replaceChildren();
      if (buckets.length === 0) { showMessage('バケットが見つかりません'); return; }

      for (const b of buckets) {
        const opt = document.createElement('option');
        opt.value = b.name;
        opt.textContent = b.name;
        sourceSelect.appendChild(opt);
      }
      // Auto-select first
      sourceSelect.value = buckets[0].name;
      void loadR2Tree(buckets[0].name);
    } catch {
      showMessage('バケットの取得に失敗しました');
    }
  };

  // ================================================================
  // Tab control
  // ================================================================

  let currentMode: 'd1' | 'r2' = 'd1';

  const activateTab = (mode: 'd1' | 'r2'): void => {
    currentMode = mode;
    d1Tab.style.background = mode === 'd1' ? C.bg : 'transparent';
    d1Tab.style.color = mode === 'd1' ? C.textBright : C.textDim;
    r2Tab.style.background = mode === 'r2' ? C.bg : 'transparent';
    r2Tab.style.color = mode === 'r2' ? C.textBright : C.textDim;

    sourceSelect.replaceChildren(placeholderOpt);
    sidebarList.replaceChildren();
    showMessage('');

    if (mode === 'd1') void loadD1Databases();
    else void loadR2Buckets();
  };

  sourceSelect.addEventListener('change', () => {
    const val = sourceSelect.value;
    if (!val) return;
    if (currentMode === 'd1') void loadD1Tables(val);
    else void loadR2Tree(val);
  });

  d1Tab.addEventListener('click', () => activateTab('d1'));
  r2Tab.addEventListener('click', () => activateTab('r2'));

  activateTab('d1');

  return root;
};
