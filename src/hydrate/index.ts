import {
  isScreenListFrame,
  isGridCanvasFrame,
  isEditorFrame,
  type ScreenListFrame,
  type GridCanvasFrame,
  type EditorFrame,
} from '../screen';
import { store, getFrameSelection, setFrameSelection } from '../state';
import { hydrateScreenList } from './screen-list';
import { hydrateGridCanvas } from './grid-canvas';
import { hydrateComponentEditor, hydrateScreenEditor } from './editor';

const findDefaultEditableFrameId = (): string | null => {
  const screen = store.screen;
  if (!screen) return null;
  const frame = screen.frames.find(
    (f) => !isScreenListFrame(f) && !isGridCanvasFrame(f) && !isEditorFrame(f),
  );
  return frame?.id ?? null;
};

const resolveEditorTargetFrameId = (canvasFrameId: string | null): string | null => {
  if (canvasFrameId) {
    const selectedFrameId = getFrameSelection(canvasFrameId);
    if (selectedFrameId) return selectedFrameId;
  }
  return findDefaultEditableFrameId();
};

export const hydrateEditor = async (
  onReload: () => void,
  initialScreenId: string | null = null,
): Promise<void> => {
  if (!store.screen) return;

  const screenListFrames = store.screen.frames.filter(
    (f): f is ScreenListFrame => isScreenListFrame(f),
  );
  const canvasFrames = store.screen.frames.filter(
    (f): f is GridCanvasFrame => isGridCanvasFrame(f),
  );
  const editorFrames = store.screen.frames.filter(
    (f): f is EditorFrame => isEditorFrame(f),
  );

  for (const screenListFrame of screenListFrames) {
    const canvasFrame = canvasFrames.find(
      (f) => f.id === screenListFrame.targetComponentId,
    );
    const editorFrame = canvasFrame
      ? editorFrames.find((f) => f.id === canvasFrame.targetComponentId)
      : undefined;

    const onFrameSelect = async (screenId: string, frameId: string | null): Promise<void> => {
      if (editorFrame) await hydrateComponentEditor(screenId, frameId, editorFrame, onReload);
    };

    const onCanvasSelect = async (screenId: string): Promise<void> => {
      if (editorFrame) await hydrateScreenEditor(screenId, editorFrame, onReload);
    };

    const onScreenSelect = async (screenId: string): Promise<void> => {
      if (canvasFrame) {
        setFrameSelection(canvasFrame.id, '');
        await hydrateGridCanvas(screenId, canvasFrame, onFrameSelect, onCanvasSelect, onReload);
      }
      if (editorFrame) {
        const targetFrameId = resolveEditorTargetFrameId(canvasFrame?.id ?? null);
        if (targetFrameId && canvasFrame) {
          setFrameSelection(canvasFrame.id, targetFrameId);
          await hydrateComponentEditor(screenId, targetFrameId, editorFrame, onReload);
        } else {
          await hydrateComponentEditor(null, null, editorFrame, onReload);
        }
      }
    };

    if (initialScreenId && !getFrameSelection(screenListFrame.id)) {
      setFrameSelection(screenListFrame.id, initialScreenId);
    }

    await hydrateScreenList(
      screenListFrame,
      onScreenSelect,
      onReload,
      canvasFrame ? () => !!getFrameSelection(canvasFrame.id) : undefined,
    );

    const savedScreenId = getFrameSelection(screenListFrame.id) || initialScreenId;
    if (savedScreenId && canvasFrame) {
      await hydrateGridCanvas(savedScreenId, canvasFrame, onFrameSelect, onCanvasSelect, onReload);
      if (editorFrame) {
        const targetFrameId = resolveEditorTargetFrameId(canvasFrame.id);
        if (targetFrameId) {
          setFrameSelection(canvasFrame.id, targetFrameId);
          await hydrateComponentEditor(savedScreenId, targetFrameId, editorFrame, onReload);
        } else {
          await hydrateComponentEditor(null, null, editorFrame, onReload);
        }
      }
    }
  }
};
