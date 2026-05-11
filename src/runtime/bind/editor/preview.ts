import type { EditorFrame, Screen } from '../../../schema/screen/screen';
import type { EditorSection } from '../../../editor/component-editor';
import { editorDefaults } from '../../../editor/component-editor';
import { CSS_PROP_KEYS } from '../../../schema/component/style';
import { getFrameSelection } from '../../../state';
import { EDITOR_ONLY_KINDS } from '../../render/canvas/preview';
import { appendSection } from '../../render/editor/section';
import { renderPlacementRow } from '../../render/editor/placement';

export const renderEditorPreview = async (
  wrapper: HTMLElement,
  frame: EditorFrame,
  screen: Screen,
  screenId: string,
): Promise<void> => {
  const sourceCanvasId = typeof frame.sourceCanvasId === 'string' ? frame.sourceCanvasId : '';
  const targetFrameFromCanvas = sourceCanvasId
    ? screen.frames.find((f) => f.id === getFrameSelection(sourceCanvasId))
    : undefined;
  const targetFrame = targetFrameFromCanvas && !EDITOR_ONLY_KINDS.has(
    String((targetFrameFromCanvas as Record<string, unknown>).kind ?? ''),
  )
    ? targetFrameFromCanvas
    : screen.frames.find(
        (f) => f.id !== frame.id && !EDITOR_ONLY_KINDS.has(String((f as Record<string, unknown>).kind ?? '')),
      ) ?? frame;

  const sections = (frame.sections ?? editorDefaults.sections) as EditorSection[];

  const container = document.createElement('div');
  for (const propKey of CSS_PROP_KEYS) {
    const v = (frame as Record<string, unknown>)[propKey];
    if (typeof v === 'string') (container.style as unknown as Record<string, string>)[propKey] = v;
  }

  const noop = async (): Promise<void> => {};

  for (const section of sections) {
    if (section.source !== 'placement') continue;
    const placementData = JSON.parse(JSON.stringify(targetFrame.placement)) as Record<string, unknown>;
    appendSection(container, { ...section, label: undefined }, renderPlacementRow(placementData, noop));
  }

  wrapper.replaceChildren(container);
};
