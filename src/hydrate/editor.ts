import { isScreen, isFrameRef } from '../screen';
import { isComponent, componentDefaults, COMPONENT_KINDS, applyDefaults } from '../component';
import type { EditorFrame, Screen } from '../screen';
import type { EditorSection, FieldStyleConfig } from '../component/kind/editor';
import type { FormField } from '../component/kind/form/field';
import { renderFormFromSchema, inferFieldsFromData, mergeWithSchema } from './form';
import { buildFieldStyleContext, type FieldStyleContext } from './field';
import { domMap } from '../state';
import { fetchSchema } from '../api';

const SECTION_SUMMARY_STYLE: Record<string, string> = {
  fontSize: '11px',
  fontWeight: '500',
  color: 'rgba(0,0,0,0.75)',
  padding: '6px 8px 4px',
  cursor: 'pointer',
  listStyle: 'none',
  userSelect: 'none',
  letterSpacing: '0.02em',
};

const SECTION_HEADING_STYLE: Record<string, string> = {
  fontSize: '11px',
  fontWeight: '500',
  color: 'rgba(0,0,0,0.75)',
  padding: '6px 8px 4px',
  margin: '0',
  letterSpacing: '0.02em',
};

const renderSectionContent = (
  data: Record<string, unknown>,
  schema: FormField[] | null,
  onSave: (draft: unknown) => Promise<void>,
  ctx: FieldStyleContext,
): HTMLElement => {
  const inferred = inferFieldsFromData(data);
  const fields = schema ? mergeWithSchema(inferred, schema) : inferred;
  return renderFormFromSchema(data, fields, onSave, ctx);
};

const appendSection = (
  parent: HTMLElement,
  section: EditorSection,
  contentEl: HTMLElement,
): void => {
  if (section.collapsible) {
    const details = document.createElement('details');
    if (!section.defaultCollapsed) details.open = true;
    if (section.label) {
      const summary = document.createElement('summary');
      summary.textContent = section.label;
      Object.assign(summary.style, SECTION_SUMMARY_STYLE);
      details.appendChild(summary);
    }
    details.appendChild(contentEl);
    parent.appendChild(details);
  } else {
    const sectionEl = document.createElement('div');
    if (section.label) {
      const heading = document.createElement('p');
      Object.assign(heading.style, SECTION_HEADING_STYLE);
      heading.textContent = section.label;
      sectionEl.appendChild(heading);
    }
    sectionEl.appendChild(contentEl);
    parent.appendChild(sectionEl);
  }
};

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

  const editorConfig = applyDefaults('component-editor', editorFrame as unknown as Record<string, unknown>);
  const sections = editorConfig.sections as EditorSection[];
  const ctx = buildFieldStyleContext(editorConfig.fieldStyle as FieldStyleConfig);

  editorEl.replaceChildren();

  if (componentKind && COMPONENT_KINDS.includes(componentKind)) {
    const kindRow = document.createElement('div');
    Object.assign(kindRow.style, {
      display: 'flex',
      alignItems: 'center',
      padding: '2px 8px',
      gap: '4px',
      minHeight: '24px',
      borderBottom: '1px solid rgba(0,0,0,0.06)',
      marginBottom: '2px',
    });
    const kindLabel = document.createElement('span');
    kindLabel.textContent = 'kind';
    Object.assign(kindLabel.style, {
      fontSize: '10px',
      color: 'rgba(0,0,0,0.65)',
      width: '80px',
      flexShrink: '0',
    });
    const kindSelect = document.createElement('select');
    Object.assign(kindSelect.style, {
      flex: '1',
      fontSize: '12px',
      border: 'none',
      borderBottom: '1px solid rgba(0,0,0,0.12)',
      background: 'transparent',
      padding: '1px 2px',
      minWidth: '0',
      outline: 'none',
      cursor: 'pointer',
    });
    for (const k of COMPONENT_KINDS) {
      const option = document.createElement('option');
      option.value = k;
      option.textContent = k;
      option.selected = k === componentKind;
      kindSelect.appendChild(option);
    }
    kindSelect.addEventListener('change', () => {
      const newKind = kindSelect.value;
      const defaults = componentDefaults[newKind];
      if (!defaults) return;
      void (async () => {
        if (componentSrc !== null) {
          await fetch(`/api/layouts/${selectedScreenId}/components/${componentSrc}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(defaults),
          });
        } else {
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
                  ? { id: f.id, placement: f.placement, ...defaults }
                  : f,
              ),
            }),
          });
        }
        onAfterSave();
      })();
    });
    kindRow.appendChild(kindLabel);
    kindRow.appendChild(kindSelect);
    editorEl.appendChild(kindRow);
  }

  for (const section of sections) {
    let contentEl: HTMLElement | null = null;

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
      contentEl = renderSectionContent(placementData, placementSchema, onSave, ctx);
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
        contentEl = renderSectionContent(propsData, propertiesSchema, onSave, ctx);
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
          contentEl = renderSectionContent(inlineProps, propertiesSchema, onSave, ctx);
        }
      }
    }

    if (!contentEl) continue;
    appendSection(editorEl, section, contentEl);
  }
};

const EDITOR_ONLY_KINDS = new Set(['canvas', 'list', 'component-editor']);

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

  const frameConfig = applyDefaults('component-editor', frame as unknown as Record<string, unknown>);
  const sections = frameConfig.sections as EditorSection[];
  const ctx = buildFieldStyleContext(frameConfig.fieldStyle as FieldStyleConfig);

  const container = document.createElement('div');
  if (frame.style) Object.assign(container.style, frame.style);

  const noop = async (): Promise<void> => {};

  for (const section of sections) {
    let contentEl: HTMLElement | null = null;

    if (section.source === 'placement') {
      const placementData = JSON.parse(JSON.stringify(targetFrame.placement)) as Record<string, unknown>;
      contentEl = renderSectionContent(placementData, placementSchema, noop, ctx);
    } else if (section.source === 'properties' && componentData) {
      const propsData = JSON.parse(JSON.stringify(componentData)) as Record<string, unknown>;
      contentEl = renderSectionContent(propsData, propertiesSchema, noop, ctx);
    }

    if (!contentEl) continue;
    appendSection(container, section, contentEl);
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
  const ctx = buildFieldStyleContext(editorFrame.fieldStyle);

  const screenData = { head: value.head, shell: value.shell, grid: value.grid } as Record<string, unknown>;
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

  editorEl.replaceChildren();

  const heading = document.createElement('p');
  Object.assign(heading.style, SECTION_HEADING_STYLE);
  heading.textContent = 'Screen';
  editorEl.appendChild(heading);
  editorEl.appendChild(renderSectionContent(screenData, screenSchema, onSave, ctx));
};
