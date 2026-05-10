import {
  isComponent,
  componentDefaults,
  COMPONENT_KINDS,
} from '../../../schema/component';
import { isFrameRef, type EditorFrame } from '../../../schema/screen/screen';
import type { EditorSection } from '../../../editor/component-editor';
import { editorDefaults } from '../../../editor/component-editor';
import { buildFieldStyleContext, type FieldStyleContext } from '../../render/editor/context';
import { domMap } from '../../../state';
import { putComponent, updateScreen, fetchScreen } from './save';
import { appendSection, createLabeledRow, renderSectionContent } from '../../render/editor/section';
import { renderPlacementRow } from '../../render/editor/placement';
import { hydrateTableEditor } from '../table/table';
import { loadComponentPropertySchema, pickEditableComponentData } from './component-properties';
import type { SchemaField } from '../../../schema/component';

const renderPropertiesSection = (
  componentData: Record<string, unknown>,
  componentKind: string | null,
  componentSchema: SchemaField[] | null,
  selectEndpointVariables: Record<string, string>,
  onSave: (patch: Record<string, unknown>) => Promise<void>,
  ctx: FieldStyleContext,
): HTMLElement =>
  renderSectionContent(
    pickEditableComponentData(componentData, componentKind, componentSchema),
    componentSchema,
    async (draft) => onSave(draft as Record<string, unknown>),
    ctx,
    true,
    selectEndpointVariables,
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
  const ctx = buildFieldStyleContext();
  const selectEndpointVariables: Record<string, string> = selectedScreenId
    ? { screenId: selectedScreenId }
    : {};

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

  const componentSchema = await loadComponentPropertySchema(componentKind);

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
      renderPropertiesSection(
        componentData,
        componentKind,
        componentSchema,
        selectEndpointVariables,
        onSave,
        ctx,
      ),
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
      renderPropertiesSection(
        componentData,
        componentKind,
        componentSchema,
        selectEndpointVariables,
        onSave,
        ctx,
      ),
    );
  }
};
