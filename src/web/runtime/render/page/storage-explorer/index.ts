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

  // --- Helpers ---

  const showMessage = (msg: string): void => {
    mainContent.replaceChildren();
    mainHeader.replaceChildren();
    if (!msg) return;
    const p = styled('div', { padding: '16px', color: C.textDim, fontSize: '12px' });
    p.textContent = msg;
    mainContent.appendChild(p);
  };

  const makeSidebarItem = (label: string, onClick: () => void): HTMLElement => {
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
    item.addEventListener('mouseenter', () => {
      if (!item.dataset.selected) item.style.background = C.hoverBg;
    });
    item.addEventListener('mouseleave', () => {
      if (!item.dataset.selected) item.style.background = '';
    });
    item.addEventListener('click', () => {
      for (const el of sidebarList.querySelectorAll<HTMLElement>('[data-selected]')) {
        el.style.background = '';
        delete el.dataset.selected;
      }
      item.dataset.selected = '1';
      item.style.background = C.selectedBg;
      onClick();
    });
    return item;
  };

  const makeTableHeader = (labels: string[]): HTMLTableSectionElement => {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    tr.style.background = C.surface;
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

  const loadD1Databases = async (): Promise<void> => {
    showMessage('データベースを読み込み中...');
    try {
      const res = await fetch('/api/viewer/d1/databases');
      if (!res.ok) { showMessage(`エラー: ${res.status}`); return; }
      const data = (await res.json()) as D1ListResponse;
      const dbs = Array.isArray(data.result) ? data.result : [];

      sourceSelect.replaceChildren();
      const ph = document.createElement('option');
      ph.value = ''; ph.textContent = '-- DB を選択 --'; ph.disabled = true; ph.selected = true;
      sourceSelect.appendChild(ph);

      if (dbs.length === 0) { showMessage('データベースが見つかりません'); return; }
      for (const db of dbs) {
        const opt = document.createElement('option');
        opt.value = db.uuid;
        opt.textContent = db.name;
        sourceSelect.appendChild(opt);
      }
      showMessage('データベースを選択してください');
    } catch {
      showMessage('データベースの取得に失敗しました');
    }
  };

  const loadD1Tables = async (dbId: string): Promise<void> => {
    sidebarList.replaceChildren();
    showMessage('テーブルを読み込み中...');
    try {
      const res = await fetch(`/api/viewer/d1/${encodeURIComponent(dbId)}/query`, {
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
        sidebarList.appendChild(makeSidebarItem(name, () => loadD1TableData(dbId, name)));
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
      const res = await fetch(`/api/viewer/d1/${encodeURIComponent(dbId)}/query`, {
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

      if (rows.length === 0) {
        const empty = styled('div', { padding: '16px', color: C.textDim });
        empty.textContent = 'データがありません';
        mainContent.appendChild(empty);
        return;
      }

      const columns = Object.keys(rows[0]);
      const table = styled('table', {
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '12px',
      });
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
  // R2
  // ================================================================

  const loadR2Buckets = async (): Promise<void> => {
    showMessage('バケットを読み込み中...');
    try {
      const res = await fetch('/api/viewer/r2/buckets');
      if (!res.ok) { showMessage(`エラー: ${res.status}`); return; }
      const data = (await res.json()) as R2BucketsResponse;
      const buckets = Array.isArray(data.buckets) ? data.buckets : [];

      sourceSelect.replaceChildren();
      const ph = document.createElement('option');
      ph.value = ''; ph.textContent = '-- バケットを選択 --'; ph.disabled = true; ph.selected = true;
      sourceSelect.appendChild(ph);

      if (buckets.length === 0) { showMessage('バケットが見つかりません'); return; }
      for (const b of buckets) {
        const opt = document.createElement('option');
        opt.value = b.name;
        opt.textContent = b.name;
        sourceSelect.appendChild(opt);
      }
      showMessage('バケットを選択してください');
    } catch {
      showMessage('バケットの取得に失敗しました');
    }
  };

  const loadR2Files = async (bucketId: string, prefix = ''): Promise<void> => {
    sidebarList.replaceChildren();
    mainContent.replaceChildren();

    // Breadcrumb
    mainHeader.replaceChildren();
    const parts = prefix.split('/').filter(Boolean);

    const makeBC = (label: string, targetPrefix: string): HTMLElement => {
      const span = styled('span', { cursor: 'pointer', color: C.accent });
      span.textContent = label;
      span.addEventListener('click', () => loadR2Files(bucketId, targetPrefix));
      return span;
    };
    const sep = (): HTMLElement => {
      const s = styled('span', { color: C.textDim });
      s.textContent = '/';
      return s;
    };

    mainHeader.appendChild(makeBC(bucketId, ''));
    for (let i = 0; i < parts.length; i++) {
      mainHeader.appendChild(sep());
      mainHeader.appendChild(makeBC(parts[i], parts.slice(0, i + 1).join('/') + '/'));
    }

    try {
      const res = await fetch('/api/viewer/r2/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket_id: bucketId, prefix, delimiter: '/' }),
      });
      if (!res.ok) { showMessage(`エラー: ${res.status}`); return; }
      const data = (await res.json()) as R2FilesResponse;
      const folders = data.delimited_prefixes ?? [];
      const files = data.objects ?? [];

      // Sidebar: folders only
      for (const folderPrefix of folders) {
        const name = folderPrefix.slice(prefix.length).replace(/\/$/, '');
        sidebarList.appendChild(
          makeSidebarItem(`📁 ${name}`, () => loadR2Files(bucketId, folderPrefix)),
        );
      }

      if (folders.length === 0 && files.length === 0) {
        const empty = styled('div', { padding: '16px', color: C.textDim });
        empty.textContent = '空のフォルダです';
        mainContent.appendChild(empty);
        return;
      }

      // Main: file list table
      const table = styled('table', { width: '100%', borderCollapse: 'collapse', fontSize: '12px' });
      table.appendChild(makeTableHeader(['名前', 'サイズ', '更新日時']));
      const tbody = document.createElement('tbody');

      for (const folderPrefix of folders) {
        const name = folderPrefix.slice(prefix.length);
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('mouseenter', () => { tr.style.background = C.hoverBg; });
        tr.addEventListener('mouseleave', () => { tr.style.background = ''; });
        tr.addEventListener('click', () => loadR2Files(bucketId, folderPrefix));

        const nameCell = styled('td', { padding: '4px 8px', borderBottom: `1px solid ${C.border}`, color: C.accent });
        nameCell.textContent = `📁 ${name}`;
        const dash = (text: string): HTMLTableCellElement => {
          const td = styled('td', { padding: '4px 8px', borderBottom: `1px solid ${C.border}`, color: C.textDim });
          td.textContent = text;
          return td;
        };
        tr.append(nameCell, dash('-'), dash('-'));
        tbody.appendChild(tr);
      }

      for (const file of files) {
        const name = file.key.slice(prefix.length);
        if (!name) continue;
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('mouseenter', () => { tr.style.background = C.hoverBg; });
        tr.addEventListener('mouseleave', () => { tr.style.background = ''; });
        tr.addEventListener('click', () => loadR2FileContent(bucketId, file.key));

        const nameCell = styled('td', { padding: '4px 8px', borderBottom: `1px solid ${C.border}`, color: C.text });
        nameCell.textContent = name;

        const sizeCell = styled('td', {
          padding: '4px 8px', borderBottom: `1px solid ${C.border}`,
          color: C.textDim, whiteSpace: 'nowrap',
        });
        sizeCell.textContent = formatSize(file.size);

        const dateCell = styled('td', {
          padding: '4px 8px', borderBottom: `1px solid ${C.border}`,
          color: C.textDim, whiteSpace: 'nowrap',
        });
        dateCell.textContent = file.uploaded
          ? new Date(file.uploaded).toLocaleString('ja-JP')
          : '-';

        tr.append(nameCell, sizeCell, dateCell);
        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      mainContent.appendChild(table);
    } catch {
      showMessage('ファイル一覧の取得に失敗しました');
    }
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
      const res = await fetch('/api/viewer/r2/file', {
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
    sidebarList.replaceChildren();
    if (currentMode === 'd1') void loadD1Tables(val);
    else void loadR2Files(val, '');
  });

  d1Tab.addEventListener('click', () => activateTab('d1'));
  r2Tab.addEventListener('click', () => activateTab('r2'));

  activateTab('d1');

  return root;
};
