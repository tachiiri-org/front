import { isScreen, isFrameRef } from '../screen';
import { isComponent } from '../component';
import type { EditorFrame, Screen } from '../screen';
import type { EditorSection } from '../component/editor';
import { renderFormFromSchema } from './form';
import { domMap } from '../state';
import { fetchSchema } from '../api';

const DEFAULT_SECTIONS: EditorSection[] = [
  { label: 'Placement', source: 'placement' },
  { label: 'Properties', source: 'properties' },
];

export const hydrateComponentEditor = async (
  selectedScreenId: string | null,
  selectedFrameId: string | null,
  editorFrame: EditorFrame,
  onAfterSave: () => void = () => {},
): Promise<void> => {
  const editorEl = domMap.get(editorFrame.id);
  if (!editorEl) return;

  if (!selectedScreenId || !selectedFrameId) {
    editorEl.replaceChildren();
    return;
  }

  const screenResponse = await fetch(`/api/layouts/${selectedScreenId}`);
  if (!screenResponse.ok) { editorEl.replaceChildren(); return; }
  const screenValue = (await screenResponse.json()) as unknown;
  if (!isScreen(screenValue)) { editorEl.replaceChildren(); return; }

  const frame = screenValue.frames.find((f) => f.id === selectedFrameId);
  if (!frame) { editorEl.replaceChildren(); return; }

  let componentKind: string | null = null;
  let componentData: Record<string, unknown> | null = null;
  let componentSrc: string | null = null;

  if (isFrameRef(frame)) {
    componentSrc = frame.src;
    const compResponse = await fetch(`/api/layouts/${selectedScreenId}/components/${frame.src}`);
    if (compResponse.ok) {
      const compValue = (await compResponse.json()) as unknown;
      if (isComponent(compValue)) {
        componentKind = (compValue as Record<string, unknown>).kind as string;
        componentData = compValue as Record<string, unknown>;
      }
    }
  } else {
    const frameObj = frame as Record<string, unknown>;
    componentKind = frameObj.kind as string;
    componentData = frameObj;
  }

  const [placementSchema, propertiesSchema] = await Promise.all([
    fetchSchema('placement'),
    componentKind ? fetchSchema(componentKind) : Promise.resolve(null),
  ]);

  const sections = editorFrame.sections ?? DEFAULT_SECTIONS;

  editorEl.replaceChildren();

  for (const section of sections) {
    const sectionEl = document.createElement('div');

    if (section.label) {
      const heading = document.createElement('p');
      heading.textContent = section.label;
      sectionEl.appendChild(heading);
    }

    if (section.source === 'placement') {
      const placementData = JSON.parse(JSON.stringify(frame.placement)) as Record<string, unknown>;
      const onSave = async (draft: unknown): Promise<void> => {
        const freshRes = await fetch(`/api/layouts/${selectedScreenId}`);
        if (!freshRes.ok) return;
        const freshScreen = (await freshRes.json()) as unknown;
        if (!isScreen(freshScreen)) return;
        await fetch(`/api/layouts/${selectedScreenId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...freshScreen,
            frames: freshScreen.frames.map((f) =>
              f.id === selectedFrameId ? { ...f, placement: draft } : f,
            ),
          }),
        });
        onAfterSave();
      };
      if (placementSchema) {
        sectionEl.appendChild(renderFormFromSchema(placementData, placementSchema, onSave));
      }
    } else if (section.source === 'properties' && componentData) {
      if (componentSrc !== null) {
        const src = componentSrc;
        const propsData = JSON.parse(JSON.stringify(componentData)) as Record<string, unknown>;
        const onSave = async (draft: unknown): Promise<void> => {
          await fetch(`/api/layouts/${selectedScreenId}/components/${src}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft),
          });
          onAfterSave();
        };
        if (propertiesSchema) {
          sectionEl.appendChild(renderFormFromSchema(propsData, propertiesSchema, onSave));
        }
      } else {
        const inlineProps: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(componentData)) {
          if (key !== 'id' && key !== 'kind' && key !== 'placement') {
            inlineProps[key] = val;
          }
        }
        if (Object.keys(inlineProps).length > 0) {
          const onSave = async (draft: unknown): Promise<void> => {
            const freshRes = await fetch(`/api/layouts/${selectedScreenId}`);
            if (!freshRes.ok) return;
            const freshScreen = (await freshRes.json()) as unknown;
            if (!isScreen(freshScreen)) return;
            await fetch(`/api/layouts/${selectedScreenId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...freshScreen,
                frames: freshScreen.frames.map((f) =>
                  f.id === selectedFrameId
                    ? { ...(f as Record<string, unknown>), ...(draft as Record<string, unknown>) }
                    : f,
                ),
              }),
            });
            onAfterSave();
          };
          if (propertiesSchema) {
            sectionEl.appendChild(renderFormFromSchema(inlineProps, propertiesSchema, onSave));
          }
        }
      }
    }

    editorEl.appendChild(sectionEl);
  }
};

const EDITOR_ONLY_KINDS = new Set(['grid-canvas', 'screen-list', 'component-editor']);

export const renderEditorPreview = async (
  wrapper: HTMLElement,
  frame: EditorFrame,
  screen: Screen,
  screenId: string,
): Promise<void> => {
  const targetFrame = screen.frames.find(
    (f) => f.id !== frame.id && !EDITOR_ONLY_KINDS.has(String((f as Record<string, unknown>).kind ?? '')),
  ) ?? frame;

  const frameObj = targetFrame as Record<string, unknown>;
  let componentKind: string | null = null;
  let componentData: Record<string, unknown> | null = null;

  if (isFrameRef(targetFrame)) {
    const compRes = await fetch(`/api/layouts/${screenId}/components/${targetFrame.src}`);
    if (compRes.ok) {
      const compValue = (await compRes.json()) as unknown;
      if (isComponent(compValue)) {
        componentKind = (compValue as Record<string, unknown>).kind as string;
        componentData = compValue as Record<string, unknown>;
      }
    }
  } else {
    componentKind = frameObj.kind as string;
    componentData = frameObj;
  }

  const [placementSchema, propertiesSchema] = await Promise.all([
    fetchSchema('placement'),
    componentKind ? fetchSchema(componentKind) : Promise.resolve(null),
  ]);

  const sections = frame.sections ?? DEFAULT_SECTIONS;

  const container = document.createElement('div');
  if (frame.style) Object.assign(container.style, frame.style);

  const noop = async (): Promise<void> => {};

  for (const section of sections) {
    const sectionEl = document.createElement('div');
    if (section.label) {
      const heading = document.createElement('p');
      heading.textContent = section.label;
      sectionEl.appendChild(heading);
    }

    if (section.source === 'placement') {
      const placementData = JSON.parse(JSON.stringify(targetFrame.placement)) as Record<string, unknown>;
      if (placementSchema) {
        sectionEl.appendChild(renderFormFromSchema(placementData, placementSchema, noop));
      }
    } else if (section.source === 'properties' && componentData) {
      const propsData = JSON.parse(JSON.stringify(componentData)) as Record<string, unknown>;
      if (propertiesSchema) {
        sectionEl.appendChild(renderFormFromSchema(propsData, propertiesSchema, noop));
      }
    }

    container.appendChild(sectionEl);
  }

  wrapper.replaceChildren(container);
};

export const hydrateScreenEditor = async (
  screenId: string,
  editorFrame: EditorFrame,
  onAfterSave: () => void = () => {},
): Promise<void> => {
  const editorEl = domMap.get(editorFrame.id);
  if (!editorEl) return;

  const response = await fetch(`/api/layouts/${screenId}`);
  if (!response.ok) { editorEl.replaceChildren(); return; }
  const value = (await response.json()) as unknown;
  if (!isScreen(value)) { editorEl.replaceChildren(); return; }

  const screenSchema = await fetchSchema('screen');

  editorEl.replaceChildren();

  const heading = document.createElement('p');
  heading.textContent = 'Screen';
  editorEl.appendChild(heading);

  if (screenSchema) {
    const onSave = async (draft: unknown): Promise<void> => {
      const freshResponse = await fetch(`/api/layouts/${screenId}`);
      if (!freshResponse.ok) return;
      const freshScreen = (await freshResponse.json()) as unknown;
      if (!isScreen(freshScreen)) return;
      await fetch(`/api/layouts/${screenId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...freshScreen, ...(draft as Record<string, unknown>) }),
      });
      onAfterSave();
    };
    editorEl.appendChild(renderFormFromSchema(
      { head: value.head, shell: value.shell, grid: value.grid } as Record<string, unknown>,
      screenSchema,
      onSave,
    ));
  }
};
