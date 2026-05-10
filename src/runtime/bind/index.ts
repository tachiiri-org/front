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

const hydrateSelectTableBindings = async (
  onFrameRerender?: (frameId: string) => void,
): Promise<void> => {
  if (!store.screen) return;

  for (const frame of store.screen.frames) {
    const c = frame as Record<string, unknown>;
    if (c.kind !== 'select') continue;
    const targetId = typeof c.targetComponentId === 'string' ? c.targetComponentId : '';
    if (!targetId) continue;

    const tableFrame = store.screen.frames.find((f) => f.id === targetId);
    if (!tableFrame || (tableFrame as Record<string, unknown>).kind !== 'table') continue;

    const selectEl = domMap.get(frame.id);
    if (!(selectEl instanceof HTMLSelectElement)) continue;

    const source = c.source as Record<string, unknown> | undefined;
    if (source?.kind === 'endpoint' && typeof source.url === 'string' && source.url) {
      try {
        const res = await fetch(source.url);
        if (res.ok) {
          const raw = (await res.json()) as unknown;
          const itemsPath = typeof source.itemsPath === 'string' ? source.itemsPath : '';
          const items = getByPath(raw, itemsPath);
          const valueKey = typeof source.valueKey === 'string' && source.valueKey ? source.valueKey : 'value';
          const labelKey = typeof source.labelKey === 'string' && source.labelKey ? source.labelKey : 'label';

          if (Array.isArray(items)) {
            for (const item of items as Record<string, unknown>[]) {
              const opt = document.createElement('option');
              opt.value = String(item[valueKey] ?? '');
              opt.textContent = String(item[labelKey] ?? opt.value);
              selectEl.appendChild(opt);
            }
            if (selectEl.options.length > 0) {
              selectEl.value = selectEl.options[0].value;
              await loadSchemaIntoTable(selectEl.value, tableFrame, onFrameRerender);
            }
          }
        }
      } catch {
        // ignore fetch errors
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
