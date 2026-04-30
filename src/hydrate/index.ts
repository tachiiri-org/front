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

export const hydrateEditor = async (onReload: () => void): Promise<void> => {
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

    const onFrameSelect = async (screenId: string, frameId: string): Promise<void> => {
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
      if (editorFrame) await hydrateComponentEditor(null, null, editorFrame, onReload);
    };

    await hydrateScreenList(
      screenListFrame,
      onScreenSelect,
      onReload,
      canvasFrame ? () => !!getFrameSelection(canvasFrame.id) : undefined,
    );

    const savedScreenId = getFrameSelection(screenListFrame.id);
    if (savedScreenId && canvasFrame) {
      await hydrateGridCanvas(savedScreenId, canvasFrame, onFrameSelect, onCanvasSelect, onReload);
      const savedFrameId = getFrameSelection(canvasFrame.id);
      if (savedFrameId && editorFrame) {
        await hydrateComponentEditor(savedScreenId, savedFrameId, editorFrame, onReload);
      }
    }
  }
};
