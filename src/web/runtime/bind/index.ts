import {
  isListFrame,
  isCanvasFrame,
  isEditorFrame,
  type ListFrame,
  type CanvasFrame,
  type EditorFrame,
  type Frame,
} from '../../schema/screen/screen';
import { store, domMap, getFrameSelection, setFrameSelection, getCanvasSelection, setCanvasSelection } from '../../state';
import { hydrateList } from './list/list';
import { hydrateCanvas } from './canvas/canvas';
import { hydrateComponentEditor } from './editor/component';
import { hydrateScreenEditor } from './editor/screen';

const findDefaultEditableFrameId = (): string | null => {
  const screen = store.screen;
  if (!screen) return null;
  const frame = screen.frames.find(
    (f) => !isListFrame(f) && !isCanvasFrame(f) && !isEditorFrame(f),
  );
  return frame?.id ?? null;
};

const resolveEditorTargetFrameId = (canvasFrameId: string | null): string | null => {
  if (canvasFrameId) {
    const sel = getCanvasSelection(canvasFrameId);
    if (sel?.kind === 'frame') return sel.id;
  }
  return findDefaultEditableFrameId();
};

const getByPath = (value: unknown, path: string | undefined): unknown => {
  if (!path) return value;
  const segments = path.split('.').filter(Boolean);
  let cur: unknown = value;
  for (const seg of segments) {
    if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
};

type TreeNode = { id: string; text: string; children?: TreeNode[] };

const tableRowsToNodes = (payload: Record<string, unknown>): TreeNode[] | null => {
  const data = payload.data as Record<string, unknown> | undefined;
  const rows = data?.rows;
  if (!Array.isArray(rows)) return null;
  return (rows as Record<string, unknown>[]).map((row) => {
    const values = row.values as Record<string, unknown> | undefined ?? {};
    const text = String(values.label || values.value || '');
    return { id: String(row.id ?? ''), text };
  });
};

const loadDataIntoTree = async (
  treeId: string,
  treeFrame: Frame,
  onFrameRerender?: (id: string) => void,
): Promise<void> => {
  const tf = treeFrame as Record<string, unknown>;
  tf.treeId = treeId;

  const res = await fetch(`/api/trees/${encodeURIComponent(treeId)}`);
  if (res.ok) {
    const payload = (await res.json()) as unknown;
    if (typeof payload === 'object' && payload !== null) {
      const nodes = (payload as Record<string, unknown>).nodes;
      if (Array.isArray(nodes) && nodes.length > 0) {
        tf.data = payload;
        onFrameRerender?.(treeFrame.id);
        return;
      }
    }
  }

  // trees/ が空か未存在 → component-schemas からフォールバック変換
  const schemaRes = await fetch(`/api/component-schemas/${encodeURIComponent(treeId)}`);
  if (schemaRes.ok) {
    const schema = (await schemaRes.json()) as unknown;
    if (typeof schema === 'object' && schema !== null) {
      const nodes = tableRowsToNodes(schema as Record<string, unknown>);
      if (nodes) {
        tf.data = { nodes };
        onFrameRerender?.(treeFrame.id);
        return;
      }
    }
  }

  tf.data = { nodes: [] };
  onFrameRerender?.(treeFrame.id);
};

const loadSchemaIntoTable = async (
  kind: string,
  tableFrame: Frame,
  onFrameRerender?: (id: string) => void,
): Promise<void> => {
  const res = await fetch(`/api/component-schemas/${encodeURIComponent(kind)}`);
  if (!res.ok) return;
  const payload = (await res.json()) as unknown;
  if (typeof payload !== 'object' || payload === null) return;
  const p = payload as Record<string, unknown>;
  const tf = tableFrame as Record<string, unknown>;
  tf.schemaEditorKind = kind;
  if (p.schema) tf.schema = p.schema;
  if (p.data) tf.data = p.data;
  onFrameRerender?.(tableFrame.id);
};

const populateSelectFromEndpoint = async (
  selectEl: HTMLSelectElement,
  url: string,
  source: Record<string, unknown>,
): Promise<void> => {
  const itemsPath = typeof source.itemsPath === 'string' ? source.itemsPath : '';
  const valueKey = typeof source.valueKey === 'string' && source.valueKey ? source.valueKey : 'value';
  const labelKey = typeof source.labelKey === 'string' && source.labelKey ? source.labelKey : 'label';
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const raw = (await res.json()) as unknown;
    const items = getByPath(raw, itemsPath);
    if (!Array.isArray(items)) return;
    while (selectEl.options.length > 0) selectEl.remove(0);
    for (const item of items as Record<string, unknown>[]) {
      const opt = document.createElement('option');
      opt.value = String(item[valueKey] ?? '');
      opt.textContent = String(item[labelKey] ?? opt.value);
      selectEl.appendChild(opt);
    }
  } catch {
    // ignore fetch errors
  }
};

const hydrateSelectTableBindings = async (
  onFrameRerender?: (frameId: string) => void,
): Promise<void> => {
  if (!store.screen) return;

  // Zero-th pass: populate inline selects
  for (const frame of store.screen.frames) {
    const c = frame as Record<string, unknown>;
    if (c.kind !== 'select') continue;
    const source = c.source as Record<string, unknown> | undefined;
    if (source?.kind !== 'inline' || !Array.isArray(source.options)) continue;
    const selectEl = domMap.get(frame.id);
    if (!(selectEl instanceof HTMLSelectElement) || selectEl.options.length > 0) continue;
    for (const opt of source.options as Array<Record<string, unknown>>) {
      const el = document.createElement('option');
      el.value = String(opt.value ?? '');
      el.textContent = String(opt.label ?? el.value);
      selectEl.appendChild(el);
    }
  }

  const cascadeTargetIds = new Set<string>();

  // First pass: cascade-driver selects
  for (const frame of store.screen.frames) {
    const c = frame as Record<string, unknown>;
    if (c.kind !== 'select') continue;
    const filterTargetId = typeof c.filterTargetId === 'string' ? c.filterTargetId : '';
    if (!filterTargetId) continue;

    const source = c.source as Record<string, unknown> | undefined;

    const categoryEl = domMap.get(frame.id);
    if (!(categoryEl instanceof HTMLSelectElement)) continue;

    const kindFrame = store.screen.frames.find((f) => f.id === filterTargetId);
    if (!kindFrame) continue;
    const kindEl = domMap.get(filterTargetId);
    if (!(kindEl instanceof HTMLSelectElement)) continue;

    const kindC = kindFrame as Record<string, unknown>;
    const kindSource = kindC.source as Record<string, unknown> | undefined;
    if (kindSource?.kind !== 'endpoint' || typeof kindSource.url !== 'string') continue;

    const tableId = typeof kindC.targetComponentId === 'string' ? kindC.targetComponentId : '';
    const tableFrame = tableId ? store.screen.frames.find((f) => f.id === tableId) : undefined;

    cascadeTargetIds.add(filterTargetId);

    const filterParamKey = typeof c.filterParamKey === 'string' ? c.filterParamKey : 'category';

    if (source?.kind === 'inline' && Array.isArray(source.options)) {
      for (const opt of source.options as Array<Record<string, unknown>>) {
        const el = document.createElement('option');
        el.value = String(opt.value ?? '');
        el.textContent = String(opt.label ?? el.value);
        categoryEl.appendChild(el);
      }
    } else if (source?.kind === 'list' && typeof source.id === 'string' && source.id) {
      await populateSelectFromEndpoint(categoryEl, `/api/component-schemas/list/${String(source.id)}`, { itemsPath: 'data.rows', valueKey: 'values.value', labelKey: 'values.label' });
    } else if (source?.kind === 'endpoint' && typeof source.url === 'string' && source.url) {
      await populateSelectFromEndpoint(categoryEl, source.url, source);
      if (!categoryEl.value && categoryEl.options.length > 0) {
        categoryEl.value = categoryEl.options[0].value;
      }
    }

    const populateKindSelect = async (categoryValue: string): Promise<void> => {
      const u = new URL(kindSource.url as string, window.location.origin);
      u.searchParams.set(filterParamKey, categoryValue);
      await populateSelectFromEndpoint(kindEl, u.toString(), kindSource);
    };

    if (categoryEl.options.length > 0) {
      await populateKindSelect(categoryEl.value);
      if (tableFrame && kindEl.options.length > 0) {
        await loadSchemaIntoTable(kindEl.value, tableFrame, onFrameRerender);
      }
    }

    categoryEl.addEventListener('change', () => {
      void populateKindSelect(categoryEl.value).then(async () => {
        if (tableFrame && kindEl.options.length > 0) {
          await loadSchemaIntoTable(kindEl.value, tableFrame, onFrameRerender);
        }
      });
    });

    if (tableFrame) {
      kindEl.addEventListener('change', () => {
        void loadSchemaIntoTable(kindEl.value, tableFrame, onFrameRerender);
      });
    }
  }

  // Second pass: standalone endpoint selects (not cascade targets)
  for (const frame of store.screen.frames) {
    const c = frame as Record<string, unknown>;
    if (c.kind !== 'select') continue;
    if (cascadeTargetIds.has(frame.id)) continue;

    const targetId = typeof c.targetComponentId === 'string' ? c.targetComponentId : '';
    if (!targetId) continue;

    const tableFrame = store.screen.frames.find((f) => f.id === targetId);
    if (!tableFrame || (tableFrame as Record<string, unknown>).kind !== 'table') continue;

    const selectEl = domMap.get(frame.id);
    if (!(selectEl instanceof HTMLSelectElement)) continue;

    const source = c.source as Record<string, unknown> | undefined;
    if (source?.kind === 'list' && typeof source.id === 'string' && source.id) {
      await populateSelectFromEndpoint(selectEl, `/api/component-schemas/list/${String(source.id)}`, { itemsPath: 'data.rows', valueKey: 'values.value', labelKey: 'values.label' });
      if (selectEl.options.length > 0) {
        selectEl.value = selectEl.options[0].value;
        await loadSchemaIntoTable(selectEl.value, tableFrame, onFrameRerender);
      }
    } else if (source?.kind === 'endpoint' && typeof source.url === 'string' && source.url) {
      await populateSelectFromEndpoint(selectEl, source.url, source);
      if (selectEl.options.length > 0) {
        selectEl.value = selectEl.options[0].value;
        await loadSchemaIntoTable(selectEl.value, tableFrame, onFrameRerender);
      }
    }

    selectEl.addEventListener('change', () => {
      void loadSchemaIntoTable(selectEl.value, tableFrame, onFrameRerender);
    });
  }

  // Third pass: sidebar nav list frames (list with endpoint source)
  for (const frame of store.screen.frames) {
    const c = frame as Record<string, unknown>;
    if (c.kind !== 'list') continue;
    const source = c.source as Record<string, unknown> | undefined;
    if (!source || typeof source.url !== 'string' || !source.url) continue;

    const listEl = domMap.get(frame.id);
    if (!(listEl instanceof HTMLElement)) continue;

    const targetId = typeof c.targetComponentId === 'string' ? c.targetComponentId : '';
    const filterSourceId = typeof c.filterSourceId === 'string' ? c.filterSourceId : '';
    const filterParamKey = typeof c.filterParamKey === 'string' ? c.filterParamKey : '';
    const itemsPath = typeof source.itemsPath === 'string' ? source.itemsPath : '';
    const valueKey = typeof source.valueKey === 'string' && source.valueKey ? source.valueKey : 'value';
    const labelKey = typeof source.labelKey === 'string' && source.labelKey ? source.labelKey : 'label';

    const targetFrame = targetId ? store.screen.frames.find((f) => f.id === targetId) : undefined;
    const filterSourceEl = filterSourceId ? domMap.get(filterSourceId) : null;

    const loadIntoTarget = (value: string): void => {
      if (!targetFrame) return;
      const kind = (targetFrame as Record<string, unknown>).kind;
      if (kind === 'tree-editor') {
        void loadDataIntoTree(value, targetFrame, onFrameRerender);
      } else {
        void loadSchemaIntoTable(value, targetFrame, onFrameRerender);
      }
    };

    let activeItem: HTMLElement | null = null;
    let currentFilter: string | undefined;

    const makeLeafItem = (value: string, label: string): HTMLLIElement => {
      const li = document.createElement('li');
      li.dataset.value = value;
      Object.assign(li.style, {
        padding: '5px 10px',
        cursor: 'pointer',
        fontSize: '12px',
        borderRadius: '3px',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      });

      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      labelEl.style.flex = '1';
      labelEl.style.overflow = 'hidden';
      labelEl.style.textOverflow = 'ellipsis';
      labelEl.style.whiteSpace = 'nowrap';

      li.appendChild(labelEl);

      li.addEventListener('mouseenter', () => {
        if (li !== activeItem) li.style.backgroundColor = 'rgba(0,0,0,0.05)';
      });
      li.addEventListener('mouseleave', () => {
        if (li !== activeItem) li.style.backgroundColor = '';
      });
      li.addEventListener('click', () => {
        if (activeItem) { activeItem.style.backgroundColor = ''; activeItem.style.fontWeight = ''; }
        li.style.backgroundColor = 'rgba(0,0,0,0.1)';
        li.style.fontWeight = 'bold';
        activeItem = li;
        loadIntoTarget(value);
      });

      return li;
    };

    const makeCategoryItem = (label: string, children: Array<{ value: string; label: string }>): HTMLLIElement => {
      const li = document.createElement('li');
      let open = true;

      const header = document.createElement('div');
      header.dataset.categoryHeader = 'true';
      Object.assign(header.style, {
        padding: '5px 10px',
        cursor: 'pointer',
        fontSize: '11px',
        fontWeight: 'bold',
        color: 'rgba(0,0,0,0.5)',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      });
      const arrow = document.createElement('span');
      arrow.textContent = '▾';
      arrow.style.fontSize = '9px';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = label.toUpperCase();
      header.appendChild(arrow);
      header.appendChild(labelSpan);

      const childUl = document.createElement('ul');
      childUl.style.listStyle = 'none';
      childUl.style.padding = '0';
      childUl.style.margin = '0';
      for (const child of children) {
        const childLi = makeLeafItem(child.value, child.label);
        childLi.style.paddingLeft = '30px';
        childUl.appendChild(childLi);
      }

      header.addEventListener('click', () => {
        open = !open;
        childUl.style.display = open ? '' : 'none';
        arrow.textContent = open ? '▾' : '▸';
      });

      li.appendChild(header);
      li.appendChild(childUl);
      return li;
    };

    const populateNavList = async (filterValue?: string): Promise<void> => {
      currentFilter = filterValue;
      const u = new URL(source.url as string, window.location.origin);
      if (filterValue && filterParamKey) u.searchParams.set(filterParamKey, filterValue);
      try {
        const res = await fetch(u.toString());
        if (!res.ok) return;
        const raw = (await res.json()) as unknown;
        const items = getByPath(raw, itemsPath);
        if (!Array.isArray(items)) return;

        const currentListEl = domMap.get(frame.id);
        if (!(currentListEl instanceof HTMLElement)) return;
        currentListEl.replaceChildren();
        activeItem = null;

        for (const item of items as Record<string, unknown>[]) {
          const value = String(item[valueKey] ?? '');
          const label = String(item[labelKey] ?? value);
          if (!value) continue;

          const children = item.children;
          if (Array.isArray(children) && children.length >= 0) {
            const childItems = (children as Record<string, unknown>[]).map((c) => ({
              value: String(c[valueKey] ?? ''),
              label: String(c[labelKey] ?? c[valueKey] ?? ''),
            })).filter((c) => c.value);
            currentListEl.appendChild(makeCategoryItem(label, childItems));
          } else {
            currentListEl.appendChild(makeLeafItem(value, label));
          }
        }
      } catch {
        // ignore fetch errors
      }
    };

    const initialFilter = filterSourceEl instanceof HTMLSelectElement ? filterSourceEl.value : undefined;
    await populateNavList(initialFilter);

    if (filterSourceEl instanceof HTMLSelectElement) {
      filterSourceEl.addEventListener('change', () => {
        void populateNavList(filterSourceEl.value);
      });
    }
  }

  // Fourth pass: navigateTo selects — populate from endpoint and navigate on change
  for (const frame of store.screen.frames) {
    const c = frame as Record<string, unknown>;
    if (c.kind !== 'select') continue;
    const navigateTo = typeof c.navigateTo === 'string' ? c.navigateTo : '';
    if (!navigateTo) continue;

    const selectEl = domMap.get(frame.id);
    if (!(selectEl instanceof HTMLSelectElement)) continue;

    const source = c.source as Record<string, unknown> | undefined;
    if (source?.kind === 'endpoint' && typeof source.url === 'string' && source.url) {
      await populateSelectFromEndpoint(selectEl, source.url, source);
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = typeof c.placeholder === 'string' ? c.placeholder : '選択...';
      placeholder.disabled = true;
      selectEl.insertBefore(placeholder, selectEl.firstChild);
      selectEl.value = '';
    }

    selectEl.addEventListener('change', () => {
      if (!selectEl.value) return;
      window.location.href = navigateTo.replace('{value}', encodeURIComponent(selectEl.value));
    });
  }

  // Fifth pass: element source.endpoint bindings
  const endpointCache = new Map<string, unknown>();
  for (const frame of store.screen.frames) {
    const c = frame as Record<string, unknown>;
    if (c.kind !== 'element') continue;
    const source = c.source as Record<string, unknown> | undefined;
    if (source?.kind !== 'endpoint' || typeof source.url !== 'string' || !source.url) continue;

    const el = domMap.get(frame.id);
    if (!(el instanceof HTMLElement)) continue;

    try {
      let payload = endpointCache.get(source.url);
      if (payload === undefined) {
        const res = await fetch(source.url);
        if (res.ok) {
          payload = (await res.json()) as unknown;
          endpointCache.set(source.url, payload);
        }
      }
      const valuePath = typeof source.valuePath === 'string' ? source.valuePath : undefined;
      const fallback = typeof source.fallback === 'string' ? source.fallback : '';
      const raw = getByPath(payload, valuePath);
      el.textContent = raw !== null && raw !== undefined && raw !== false
        ? String(raw)
        : fallback;
    } catch {
      // ignore fetch errors
    }
  }
};

export const hydrateEditor = async (
  onReload: () => void,
  initialScreenId: string | null = null,
  onFrameRerender?: (frameId: string) => void,
): Promise<void> => {
  if (!store.screen) return;

  const listFrames = store.screen.frames.filter(
    (f): f is ListFrame =>
      isListFrame(f) &&
      (f.source === undefined || typeof (f.source as Record<string, unknown>).url !== 'string'),
  );
  const canvasFrames = store.screen.frames.filter(
    (f): f is CanvasFrame => isCanvasFrame(f),
  );
  const editorFrames = store.screen.frames.filter(
    (f): f is EditorFrame => isEditorFrame(f),
  );

  for (const listFrame of listFrames) {
    const canvasFrame = canvasFrames.find(
      (f) => f.id === listFrame.targetComponentId,
    );
    const editorFrame = canvasFrame
      ? editorFrames.find((f) => f.sourceCanvasId === canvasFrame.id)
      : undefined;

    const onFrameSelect = async (screenId: string, frameId: string | null): Promise<void> => {
      if (editorFrame) await hydrateComponentEditor(screenId, frameId, editorFrame, onReload);
    };

    const onCanvasSelect = async (screenId: string): Promise<void> => {
      if (editorFrame) await hydrateScreenEditor(screenId, editorFrame, onReload);
    };

    const onScreenSelect = async (screenId: string): Promise<void> => {
      if (canvasFrame) {
        setCanvasSelection(canvasFrame.id, null);
        await hydrateCanvas(screenId, canvasFrame, onFrameSelect, onCanvasSelect, onReload);
      }
      if (editorFrame) {
        const targetFrameId = resolveEditorTargetFrameId(canvasFrame?.id ?? null);
        if (targetFrameId && canvasFrame) {
          setCanvasSelection(canvasFrame.id, { kind: 'frame', id: targetFrameId });
          await hydrateComponentEditor(screenId, targetFrameId, editorFrame, onReload);
        } else {
          await hydrateComponentEditor(null, null, editorFrame, onReload);
        }
      }
    };

    if (initialScreenId && !getFrameSelection(listFrame.id)) {
      setFrameSelection(listFrame.id, initialScreenId);
    }

    await hydrateList(
      listFrame,
      onScreenSelect,
      onReload,
      canvasFrame ? () => getCanvasSelection(canvasFrame.id) !== null : undefined,
    );

    const savedScreenId = getFrameSelection(listFrame.id) || initialScreenId;
    if (savedScreenId && canvasFrame) {
      await hydrateCanvas(savedScreenId, canvasFrame, onFrameSelect, onCanvasSelect, onReload);
      if (editorFrame) {
        const canvasSel = getCanvasSelection(canvasFrame.id);
        if (canvasSel?.kind === 'canvas') {
          await hydrateScreenEditor(savedScreenId, editorFrame, onReload);
        } else {
          const targetFrameId = resolveEditorTargetFrameId(canvasFrame.id);
          if (targetFrameId) {
            setCanvasSelection(canvasFrame.id, { kind: 'frame', id: targetFrameId });
            await hydrateComponentEditor(savedScreenId, targetFrameId, editorFrame, onReload);
          } else {
            await hydrateComponentEditor(null, null, editorFrame, onReload);
          }
        }
      }
    }
  }

  await hydrateSelectTableBindings(onFrameRerender);
  await hydrateMigrationComponents();
  await hydrateMigrationApplyComponents();
};

type DbApplyStatus = {
  label: string;
  applied: string[];
  pendingExpand: string[];
  pendingContract: string[];
  tableExists: boolean;
};

const hydrateMigrationApplyComponents = async (): Promise<void> => {
  if (!store.screen) return;

  const frames = store.screen.frames as Array<Record<string, unknown>>;

  const progressFrame = frames.find((f) => f.name === 'db-apply-progress');
  const statusFrame = frames.find((f) => f.name === 'db-apply-status');

  const progressEl = progressFrame?.id ? domMap.get(progressFrame.id as string) : null;
  const statusEl = statusFrame?.id ? domMap.get(statusFrame.id as string) : null;

  if (progressEl instanceof HTMLElement) {
    progressEl.style.cssText = 'overflow-y:auto;max-height:60vh;background:#1e1e1e;border-radius:4px;padding:6px 8px';
  }

  const ts = (): string => new Date().toLocaleTimeString('ja-JP', { hour12: false });

  const log = (msg: string, isError = false): void => {
    if (!(progressEl instanceof HTMLElement)) return;
    const line = document.createElement('div');
    line.textContent = `[${ts()}] ${msg}`;
    line.style.cssText = `font-size:12px;padding:1px 0;white-space:pre-wrap;word-break:break-all;font-family:monospace;color:${isError ? '#f87171' : '#d4d4d4'}`;
    progressEl.appendChild(line);
    progressEl.scrollTop = progressEl.scrollHeight;
  };

  const renderDbBlock = (
    info: DbApplyStatus,
    indent = false,
  ): HTMLElement => {
    const hasPending = info.pendingExpand.length > 0 || info.pendingContract.length > 0;
    const div = document.createElement('div');
    div.style.cssText = `margin-bottom:5px;padding:4px 8px;border-left:3px solid ${hasPending ? '#b45309' : '#15803d'};background:#fafafa`;

    const title = document.createElement('div');
    title.style.cssText = `font-weight:600;color:#222;${indent ? 'font-size:11px' : ''}`;
    title.textContent = info.label + (!info.tableExists ? ' ⚠ 未初期化' : '');
    div.appendChild(title);

    const row = (color: string, text: string): void => {
      const d = document.createElement('div');
      d.style.cssText = `color:${color};font-size:11px;padding-left:8px`;
      d.textContent = text;
      div.appendChild(d);
    };

    row('#666', `適用済み (${info.applied.length}): ${info.applied.join(', ') || 'なし'}`);

    if (info.pendingExpand.length > 0) {
      row('#b45309', `▶ Expand 待機 (${info.pendingExpand.length}): ${info.pendingExpand.join(', ')}`);
    } else {
      row('#15803d', '✓ Expand: 待機なし');
    }

    if (info.pendingContract.length > 0) {
      row('#b45309', `▶ Contract 待機 (${info.pendingContract.length}): ${info.pendingContract.join(', ')}`);
    } else {
      row('#15803d', '✓ Contract: 待機なし');
    }

    return div;
  };

  const loadStatus = async (): Promise<void> => {
    if (!(statusEl instanceof HTMLElement)) return;
    statusEl.style.cssText = 'overflow-y:auto;font-size:12px;font-family:monospace';
    statusEl.innerHTML = '<span style="color:#888">読み込み中...</span>';

    try {
      const res = await fetch('/api/admin/db-apply/status');
      if (!res.ok) {
        const errMsg = res.status === 401
          ? 'GitHub連携が必要です。まず /oauth/github/connect/start で認証してください。'
          : `ステータス取得失敗: HTTP ${res.status}`;
        statusEl.innerHTML = `<span style="color:#dc2626">${errMsg}</span>`;
        return;
      }

      const data = await res.json() as {
        identity: DbApplyStatus;
        userDbs: DbApplyStatus[];
      };

      const container = document.createElement('div');

      container.appendChild(renderDbBlock(data.identity));

      if (data.userDbs.length === 0) {
        const none = document.createElement('div');
        none.style.cssText = 'color:#888;font-size:11px;margin-top:4px';
        none.textContent = 'User DBs: なし (非本番環境では存在しない場合があります)';
        container.appendChild(none);
      } else {
        const hdr = document.createElement('div');
        hdr.style.cssText = 'font-weight:600;color:#444;margin-top:4px;margin-bottom:3px;font-size:12px';
        hdr.textContent = `User DBs (${data.userDbs.length} 件)`;
        container.appendChild(hdr);
        for (const db of data.userDbs) {
          container.appendChild(renderDbBlock(db, true));
        }
      }

      const footer = document.createElement('div');
      footer.style.cssText = 'color:#aaa;font-size:10px;margin-top:6px';
      footer.textContent = `最終更新: ${ts()}`;
      container.appendChild(footer);

      statusEl.replaceChildren(container);
    } catch (e) {
      statusEl.innerHTML = `<span style="color:#dc2626">エラー: ${String(e)}</span>`;
    }
  };

  await loadStatus();

  const bindApplyButton = (frameName: string, endpoint: string, label: string): void => {
    const btnFrame = frames.find((f) => f.name === frameName);
    const btn = btnFrame?.id ? domMap.get(btnFrame.id as string) : null;
    if (!(btn instanceof HTMLButtonElement)) return;

    btn.addEventListener('click', () => {
      void (async () => {
        if (progressEl instanceof HTMLElement) progressEl.replaceChildren();
        btn.disabled = true;
        log(`=== ${label} 開始 ===`);
        try {
          const res = await fetch(`/api/admin/db-apply/${endpoint}`, { method: 'POST' });
          const body = await res.json() as Record<string, unknown>;
          if (!res.ok) {
            log(`失敗 (HTTP ${res.status}): ${String(body.message ?? body.error_code ?? '')}`, true);
            return;
          }
          if ('results' in body && Array.isArray(body.results)) {
            for (const r of body.results as Array<{ label: string; applied: string[]; skipped: string[]; error?: string }>) {
              if (r.error) {
                log(`  [${r.label}] エラー: ${r.error}`, true);
              } else if (r.applied.length === 0 && r.skipped.length === 0) {
                log(`  [${r.label}] 該当ファイルなし (ブランチにマイグレーションファイルがありません)`);
              } else {
                log(`  [${r.label}] 適用: ${r.applied.length}件 [${r.applied.join(', ') || 'なし'}] / スキップ: ${r.skipped.length}件`);
              }
            }
            log(`=== 完了 (${(body.total as number | undefined) ?? (body.results as unknown[]).length} DB) ===`);
          } else {
            const r = body as { applied: string[]; skipped: string[]; error?: string };
            if (r.error) {
              log(`エラー: ${r.error}`, true);
            } else if (r.applied.length === 0 && r.skipped.length === 0) {
              log('該当ファイルなし (ブランチにマイグレーションファイルがありません)');
            } else {
              log(`適用: ${r.applied.length}件 [${r.applied.join(', ') || 'なし'}] / スキップ: ${r.skipped.length}件`);
            }
            log('=== 完了 ===');
          }
          await loadStatus();
        } catch (e) {
          log(`予期しないエラー: ${String(e)}`, true);
        } finally {
          btn.disabled = false;
        }
      })();
    });
  };

  bindApplyButton('db-apply-identity-expand', 'identity/expand', 'Identity Expand');
  bindApplyButton('db-apply-identity-contract', 'identity/contract', 'Identity Contract');
  bindApplyButton('db-apply-user-expand', 'user-dbs/expand', 'User DB Expand');
  bindApplyButton('db-apply-user-contract', 'user-dbs/contract', 'User DB Contract');

  const pollCiStatus = async (): Promise<void> => {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 10000));
      try {
        const res = await fetch('/api/admin/db-apply/ci-status');
        if (!res.ok) continue;
        const body = await res.json() as { run: { status: string; conclusion: string | null; html_url: string; name: string } | null };
        const run = body.run;
        if (!run) { log(`CI 待機中... (${i + 1}/${maxAttempts})`); continue; }
        log(`CI [${run.name}] status: ${run.status} / conclusion: ${run.conclusion ?? '—'}`);
        if (run.status === 'completed') {
          const ok = run.conclusion === 'success';
          log(`=== CI ${ok ? '成功' : '失敗'}: ${run.html_url} ===`, !ok);
          return;
        }
      } catch { /* retry */ }
    }
    log('CI ステータス確認タイムアウト', true);
  };

  const ciDeployFrame = frames.find((f) => f.name === 'db-apply-ci-deploy');
  const ciDeployBtn = ciDeployFrame?.id ? domMap.get(ciDeployFrame.id as string) : null;
  if (ciDeployBtn instanceof HTMLButtonElement) {
    ciDeployBtn.addEventListener('click', () => {
      void (async () => {
        if (progressEl instanceof HTMLElement) progressEl.replaceChildren();
        ciDeployBtn.disabled = true;
        log('=== CI デプロイ開始 (stage → main) ===');
        try {
          const res = await fetch('/api/admin/db-apply/ci-deploy', { method: 'POST' });
          const body = await res.json() as { merged?: boolean; alreadyUpToDate?: boolean; conflict?: boolean };
          if (res.status === 409) { log('コンフリクトが発生しました。手動で解決してください。', true); return; }
          if (!res.ok) { log(`失敗: HTTP ${res.status}`, true); return; }
          if (body.alreadyUpToDate) log('既に最新 (already up to date)');
          else log('マージ完了。CI ワークフロー開始を待っています...');
          await pollCiStatus();
        } catch (e) {
          log(`予期しないエラー: ${String(e)}`, true);
        } finally {
          ciDeployBtn.disabled = false;
        }
      })();
    });
  }
};

const hydrateMigrationComponents = async (): Promise<void> => {
  if (!store.screen) return;

  const frames = store.screen.frames as Array<Record<string, unknown>>;
  const startFrame = frames.find((f) => f.name === 'migration-start');
  const targetFrame = frames.find((f) => f.name === 'migration-target');
  const progressFrame = frames.find((f) => f.name === 'migration-progress');

  if (!startFrame || !progressFrame) return;

  const startBtn = startFrame.id ? domMap.get(startFrame.id as string) : null;
  const progressEl = progressFrame.id ? domMap.get(progressFrame.id as string) : null;

  if (!(startBtn instanceof HTMLButtonElement) || !(progressEl instanceof HTMLElement)) return;

  progressEl.style.overflowY = 'auto';
  if (!progressEl.style.maxHeight) progressEl.style.maxHeight = '60vh';

  const ts = (): string => new Date().toLocaleTimeString('ja-JP', { hour12: false });

  const log = (msg: string, isError = false, indent = 0): void => {
    const line = document.createElement('div');
    line.textContent = `[${ts()}] ${'  '.repeat(indent)}${msg}`;
    line.style.cssText = `font-size:12px;padding:1px 0;color:${isError ? '#dc2626' : isError === false && indent === 0 ? '#1d4ed8' : 'inherit'};font-family:monospace`;
    progressEl.appendChild(line);
    progressEl.scrollTop = progressEl.scrollHeight;
  };

  const logErr = async (res: Response, context: string): Promise<void> => {
    try {
      const body = await res.json() as Record<string, unknown>;
      const msg = body.message ?? body.error_code ?? res.status;
      const detail = body.details ? ` / ${String(body.details)}` : '';
      log(`${context}: ${String(msg)}${detail}`, true);
    } catch {
      log(`${context}: HTTP ${res.status}`, true);
    }
  };

  startBtn.addEventListener('click', () => {
    void (async () => {
      const targetEl = targetFrame?.id ? domMap.get(targetFrame.id as string) : null;
      const target = targetEl instanceof HTMLSelectElement ? targetEl.value : '';
      if (!target) { log('対象環境を選択してください', true); return; }

      progressEl.replaceChildren();
      startBtn.disabled = true;
      log(`=== マイグレーション開始: prod → ${target} ===`);

      try {
        log('スキーマ移行中 (DROP → CREATE)...');
        const schemaRes = await fetch('/api/admin/migration/schema', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target }),
        });
        if (!schemaRes.ok) {
          await logErr(schemaRes, 'スキーマ失敗');
          return;
        }
        const schema = await schemaRes.json() as {
          tables: string[]; views: string[]; dataTableOrder: string[];
          dropped: string[]; droppedExcluded: string[];
        };
        log(`スキーマ完了: DROP ${(schema.dropped ?? []).length + (schema.droppedExcluded ?? []).length} → CREATE ${schema.tables.length} tables + ${schema.views.length} views`);
        if (schema.droppedExcluded?.length) {
          log(`  除外テーブル (DROP のみ): ${schema.droppedExcluded.join(', ')}`, false, 1);
        }
        log(`  作成テーブル: ${schema.tables.join(', ')}`, false, 1);
        if (schema.views.length) log(`  作成ビュー: ${schema.views.join(', ')}`, false, 1);
        log(`  データ移行順 (${schema.dataTableOrder.length}件): ${schema.dataTableOrder.join(' → ')}`, false, 1);

        let succeeded = 0;
        for (const tableName of schema.dataTableOrder) {
          log(`[${tableName}] 移行中... (${succeeded + 1}/${schema.dataTableOrder.length})`, false, 1);
          const tableRes = await fetch('/api/admin/migration/table', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target, table: tableName }),
          });
          if (!tableRes.ok) {
            await logErr(tableRes, `[${tableName}] 失敗`);
            log(`中断 (${succeeded}/${schema.dataTableOrder.length} テーブル完了)`, true);
            return;
          }
          const result = await tableRes.json() as {
            migrated: number; encryptedPairs: string[]; reencrypted: number; legacy: number;
          };
          const encPairs = result.encryptedPairs ?? [];
          const encInfo = encPairs.length > 0
            ? ` | 暗号列:[${encPairs.join(',')}] 再暗号:${result.reencrypted ?? 0}${(result.legacy ?? 0) > 0 ? ` legacy→enc:${result.legacy}` : ''}`
            : ' | 暗号化列なし';
          log(`[${tableName}] ✓ ${result.migrated} 行${encInfo}`, false, 1);
          succeeded++;
        }

        log(`Identity DB 完了 (${succeeded} テーブル)`);

        log('テナント DB 移行中...');
        const userDbRes = await fetch('/api/admin/migration/user-databases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target }),
        });
        if (!userDbRes.ok) {
          await logErr(userDbRes, 'テナントDB移行失敗');
          return;
        }
        const userDb = await userDbRes.json() as {
          tenants: Array<{ groupId: string; newDbId: string; tables: string[]; totalRows: number }>;
          deleted: number;
        };
        for (const t of userDb.tenants) {
          log(`[${t.groupId}] ✓ ${t.totalRows} 行 / ${t.tables.length} テーブル → ${t.newDbId}`, false, 1);
        }
        if (userDb.deleted > 0) log(`旧テナントDB 削除: ${userDb.deleted} 件`, false, 1);
        log(`=== マイグレーション完了 (Identity: ${succeeded} テーブル / テナントDB: ${userDb.tenants.length} 件) ===`);
      } catch (e) {
        log(`予期しないエラー: ${String(e)}`, true);
      } finally {
        startBtn.disabled = false;
      }
    })();
  });
};
