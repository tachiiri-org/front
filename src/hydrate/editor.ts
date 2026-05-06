import { isScreen, isFrameRef, isCanvasFrame } from '../screen';
import { isComponent, componentDefaults, COMPONENT_KINDS, applyDefaults } from '../component';
import type { EditorFrame, Screen } from '../screen';
import type { EditorSection } from '../component/kind/component-editor';
import type { FormField } from '../component/kind/form/field';
import { renderFormFromSchema, inferFieldsFromData, mergeWithSchema } from './form';
import { buildFieldStyleContext, type FieldStyleContext } from './field';
import { domMap, getFrameSelection } from '../state';
import { getSchema } from '../api';

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

const createLabeledRow = (label: string): HTMLDivElement => {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 8px',
    gap: '4px',
    minHeight: '30px',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    marginBottom: '4px',
  });

  const rowLabel = document.createElement('span');
  rowLabel.textContent = label;
  Object.assign(rowLabel.style, {
    fontSize: '10px',
    color: 'rgba(0,0,0,0.65)',
    width: '80px',
    flexShrink: '0',
  });
  row.appendChild(rowLabel);

  return row;
};

const PLACEMENT_FIELDS: { key: string; label: string }[] = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'width', label: 'W' },
  { key: 'height', label: 'H' },
];

const renderPlacementRow = (
  data: Record<string, unknown>,
  onSave: (draft: unknown) => Promise<void>,
): HTMLElement => {
  const draft = { ...data };
  // layout: margin(1) | X(2) | gap(1) | Y(2) | gap(1) | W(2) | gap(1) | H(2) | margin(1)
  const container = document.createElement('div');
  Object.assign(container.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 2fr 1fr 2fr 1fr 2fr 1fr 2fr 1fr',
    rowGap: '2px',
    padding: '6px 0',
  });

  PLACEMENT_FIELDS.forEach(({ key, label }, i) => {
    const col = String(2 + i * 2);

    const lbl = document.createElement('span');
    lbl.textContent = label;
    Object.assign(lbl.style, {
      gridColumn: col,
      gridRow: '1',
      fontSize: '10px',
      fontWeight: '500',
      color: 'rgba(0,0,0,0.45)',
      letterSpacing: '0.06em',
    });

    const input = document.createElement('input');
    input.type = 'number';
    const current = data[key];
    input.value = typeof current === 'number' ? String(current) : '';
    Object.assign(input.style, {
      gridColumn: col,
      gridRow: '2',
      minWidth: '0',
      fontSize: '12px',
      border: 'none',
      borderBottom: '1px solid rgba(0,0,0,0.15)',
      background: 'transparent',
      padding: '2px 4px',
      outline: 'none',
      textAlign: 'center',
      boxSizing: 'border-box',
    });
    input.addEventListener('input', () => {
      const next = input.value.trim();
      draft[key] = next === '' ? 0 : Number(next);
    });
    input.addEventListener('blur', () => { void onSave(draft); });

    container.appendChild(lbl);
    container.appendChild(input);
  });

  return container;
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

  const editorConfig = applyDefaults('component-editor', editorFrame as unknown as Record<string, unknown>);
  const sections = editorConfig.sections as EditorSection[];

  editorEl.replaceChildren();

  const saveSelectedFrameUpdate = async (patch: Record<string, unknown>): Promise<void> => {
    if (componentSrc !== null) {
      await fetch(`/api/layouts/${selectedScreenId}/components/${componentSrc}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(componentData ?? {}), ...patch }),
      });
      onAfterSave();
      return;
    }

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
          f.id === selectedFrameId ? { ...(f as Record<string, unknown>), ...patch } : f,
        ),
      }),
    });
    onAfterSave();
  };

  if (componentKind && COMPONENT_KINDS.includes(componentKind)) {
    const kindRow = createLabeledRow('kind');
    const kindSelect = document.createElement('select');
    Object.assign(kindSelect.style, {
      flex: '1',
      fontSize: '12px',
      border: 'none',
      borderBottom: '1px solid rgba(0,0,0,0.12)',
      background: 'transparent',
      padding: '3px 2px',
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
    kindRow.appendChild(kindSelect);
    editorEl.appendChild(kindRow);
  }

  if (componentKind === 'component-editor' && componentData) {
    const sourceCanvasRow = createLabeledRow('sourceCanvasId');
    const sourceCanvasSelect = document.createElement('select');
    Object.assign(sourceCanvasSelect.style, {
      flex: '1',
      fontSize: '12px',
      border: 'none',
      borderBottom: '1px solid rgba(0,0,0,0.12)',
      background: 'transparent',
      padding: '3px 2px',
      minWidth: '0',
      outline: 'none',
      cursor: 'pointer',
    });

    const currentSourceCanvasId = typeof componentData.sourceCanvasId === 'string'
      ? componentData.sourceCanvasId
      : '';
    const canvasFrames = screenValue.frames.filter(isCanvasFrame);
    const knownCanvasIds = new Set(canvasFrames.map((canvasFrame) => canvasFrame.id));

    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = '(none)';
    sourceCanvasSelect.appendChild(noneOption);

    if (currentSourceCanvasId && !knownCanvasIds.has(currentSourceCanvasId)) {
      const option = document.createElement('option');
      option.value = currentSourceCanvasId;
      option.textContent = `${currentSourceCanvasId} (missing)`;
      sourceCanvasSelect.appendChild(option);
    }

    for (const canvasFrame of canvasFrames) {
      const option = document.createElement('option');
      option.value = canvasFrame.id;
      option.textContent = canvasFrame.id;
      sourceCanvasSelect.appendChild(option);
    }

    sourceCanvasSelect.value = currentSourceCanvasId;
    sourceCanvasSelect.addEventListener('change', () => {
      void saveSelectedFrameUpdate({ sourceCanvasId: sourceCanvasSelect.value });
    });

    sourceCanvasRow.appendChild(sourceCanvasSelect);
    editorEl.appendChild(sourceCanvasRow);
  }

  for (const section of sections) {
    if (section.source !== 'placement') continue;
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
    appendSection(editorEl, { ...section, label: undefined }, renderPlacementRow(placementData, onSave));
  }
};

const EDITOR_ONLY_KINDS = new Set(['canvas', 'list', 'component-editor']);

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

  const frameConfig = applyDefaults('component-editor', frame as unknown as Record<string, unknown>);
  const sections = frameConfig.sections as EditorSection[];

  const container = document.createElement('div');
  if (frame.style) Object.assign(container.style, frame.style);

  const noop = async (): Promise<void> => {};

  for (const section of sections) {
    if (section.source !== 'placement') continue;
    const placementData = JSON.parse(JSON.stringify(targetFrame.placement)) as Record<string, unknown>;
    appendSection(container, { ...section, label: undefined }, renderPlacementRow(placementData, noop));
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

  const screenSchema = getSchema('screen');
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
