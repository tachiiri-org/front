import {
  isComponent,
  componentDefaults,
  componentSchemas,
  COMPONENT_KINDS,
  type FormField,
} from '../../../schema/component';
import { isFrameRef, isCanvasFrame, type EditorFrame } from '../../../schema/screen/screen';
import type { EditorSection } from '../../../editor/component-editor';
import { editorDefaults, editorSchema } from '../../../editor/component-editor';
import { getEntityDisplayName } from '../../../schema/component/name';
import { buildFieldStyleContext, type FieldStyleContext } from '../../render/editor/context';
import { domMap } from '../../../state';
import { putComponent, updateScreen, fetchScreen } from './save';
import { appendSection, createLabeledRow, renderSectionContent } from '../../render/editor/section';
import { renderPlacementRow } from '../../render/editor/placement';
import { hydrateTableEditor } from '../table/table';

const getPropertiesSchema = (componentKind: string | null): FormField[] | null => {
  if (!componentKind) return null;
  if (componentKind === 'component-editor') return editorSchema;
  return componentSchemas[componentKind] ?? null;
};

const pickEditableData = (
  data: Record<string, unknown>,
  fields: FormField[] | null,
): Record<string, unknown> => {
  if (!fields) {
    const editable: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(data, 'name')) editable.name = data.name;
    return editable;
  }

  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (!('key' in field) || !field.key) continue;
    const value = data[field.key];
    if (field.kind === 'field-group') {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        picked[field.key] = pickEditableData(value as Record<string, unknown>, field.fields);
      } else {
        picked[field.key] = pickEditableData({}, field.fields);
      }
      continue;
    }
    if (field.kind === 'object-list-field') {
      picked[field.key] = Array.isArray(value)
        ? value.map((item) =>
          typeof item === 'object' && item !== null && !Array.isArray(item)
            ? pickEditableData(item as Record<string, unknown>, field.fields)
            : pickEditableData({}, field.fields))
        : [];
      continue;
    }
    if (value !== undefined) picked[field.key] = value;
  }
  return picked;
};

const renderPropertiesSection = (
  componentData: Record<string, unknown>,
  componentKind: string | null,
  onSave: (patch: Record<string, unknown>) => Promise<void>,
  ctx: FieldStyleContext,
): HTMLElement =>
  renderSectionContent(
    pickEditableData(componentData, getPropertiesSchema(componentKind)),
    getPropertiesSchema(componentKind),
    async (draft) => onSave(draft as Record<string, unknown>),
    ctx,
    true,
  );

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

  const screenValue = await fetchScreen(selectedScreenId);
  if (!screenValue) { editorEl.replaceChildren(); return; }

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

  const sections = (editorFrame.sections ?? editorDefaults.sections) as EditorSection[];
  const ctx = buildFieldStyleContext(editorFrame.fieldStyle);

  editorEl.replaceChildren();
  let renderedProperties = false;

  const saveSelectedFrameUpdate = async (patch: Record<string, unknown>): Promise<void> => {
    if (componentSrc !== null) {
      await putComponent(selectedScreenId, componentSrc, { ...(componentData ?? {}), ...patch });
      onAfterSave();
      return;
    }
    await updateScreen(selectedScreenId, (s) => ({
      ...s,
      frames: s.frames.map((f) =>
        f.id === selectedFrameId ? { ...(f as Record<string, unknown>), ...patch } : f,
      ),
    }));
    onAfterSave();
  };

  if (componentKind && COMPONENT_KINDS.includes(componentKind)) {
    if (componentKind !== 'table') {
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
            await putComponent(selectedScreenId, componentSrc, defaults);
          } else {
            await updateScreen(selectedScreenId, (s) => ({
              ...s,
              frames: s.frames.map((f) =>
                f.id === selectedFrameId
                  ? { id: f.id, placement: f.placement, ...defaults }
                  : f,
              ),
            }));
          }
          onAfterSave();
        })();
      });
      kindRow.appendChild(kindSelect);
      editorEl.appendChild(kindRow);
    }
  }

  if (componentKind === 'table' && componentData) {
    await hydrateTableEditor(editorEl, editorFrame, componentData, saveSelectedFrameUpdate);
    renderedProperties = true;
  }

  if (componentKind === 'component-editor' && componentData) {
    const sourceCanvasRow = createLabeledRow('source');
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
    const knownCanvasIds = new Set(canvasFrames.map((cf) => cf.id));

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
      option.textContent = getEntityDisplayName(canvasFrame as Record<string, unknown> & { id: string });
      option.title = canvasFrame.id;
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
      await updateScreen(selectedScreenId, (s) => ({
        ...s,
        frames: s.frames.map((f) =>
          f.id === selectedFrameId ? { ...f, placement: draft } : f,
        ),
      }));
      onAfterSave();
    };
    appendSection(editorEl, { ...section, label: undefined }, renderPlacementRow(placementData, onSave));
  }

  for (const section of sections) {
    if (section.source !== 'properties') continue;
    if (!componentKind || !componentData) continue;
    const onSave = async (draft: unknown): Promise<void> => {
      await saveSelectedFrameUpdate(draft as Record<string, unknown>);
    };
    appendSection(
      editorEl,
      section,
      renderPropertiesSection(componentData, componentKind, onSave, ctx),
    );
    renderedProperties = true;
  }

  if (!renderedProperties && componentKind && componentData) {
    const onSave = async (draft: unknown): Promise<void> => {
      await saveSelectedFrameUpdate(draft as Record<string, unknown>);
    };
    appendSection(
      editorEl,
      { source: 'properties', label: 'properties' },
      renderPropertiesSection(componentData, componentKind, onSave, ctx),
    );
  }
};
