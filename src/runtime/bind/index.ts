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

  const cascadeTargetIds = new Set<string>();

  // First pass: cascade-driver selects (inline source with filterTargetId)
  for (const frame of store.screen.frames) {
    const c = frame as Record<string, unknown>;
    if (c.kind !== 'select') continue;
    const filterTargetId = typeof c.filterTargetId === 'string' ? c.filterTargetId : '';
    if (!filterTargetId) continue;

    const source = c.source as Record<string, unknown> | undefined;
    if (source?.kind !== 'inline' || !Array.isArray(source.options)) continue;

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

    for (const opt of source.options as Array<Record<string, unknown>>) {
      const el = document.createElement('option');
      el.value = String(opt.value ?? '');
      el.textContent = String(opt.label ?? el.value);
      categoryEl.appendChild(el);
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
    if (source?.kind === 'endpoint' && typeof source.url === 'string' && source.url) {
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
};

export const hydrateEditor = async (
  onReload: () => void,
  initialScreenId: string | null = null,
  onFrameRerender?: (frameId: string) => void,
): Promise<void> => {
  if (!store.screen) return;

  const listFrames = store.screen.frames.filter(
    (f): f is ListFrame => isListFrame(f),
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
