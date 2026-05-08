import {
  isListFrame,
  isCanvasFrame,
  isEditorFrame,
  type ListFrame,
  type CanvasFrame,
  type EditorFrame,
} from '../screen';
import { store, getFrameSelection, setFrameSelection, getCanvasSelection, setCanvasSelection } from '../state';
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

export const hydrateEditor = async (
  onReload: () => void,
  initialScreenId: string | null = null,
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
};
