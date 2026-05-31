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

  // Fourth pass: element source.endpoint bindings
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
};
