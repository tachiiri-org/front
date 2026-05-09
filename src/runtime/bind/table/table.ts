import type { EditorFrame } from '../../../schema/screen/screen';
import { buildFieldStyleContext } from '../../render/editor/context';
import { appendSection } from '../../render/editor/section';
import { renderTablePropertiesContent } from './properties';
import { renderTableSchemaContent } from './schema';
import { renderTableDataContent } from './data';

export const hydrateTableEditor = async (
  editorEl: HTMLElement,
  editorFrame: EditorFrame,
  componentData: Record<string, unknown>,
  onSave: (patch: Record<string, unknown>) => Promise<void>,
): Promise<void> => {
  const ctx = buildFieldStyleContext(editorFrame.fieldStyle);

  editorEl.replaceChildren();

  appendSection(
    editorEl,
    { source: 'properties', label: 'properties' },
    renderTablePropertiesContent(componentData, onSave, ctx),
  );

  appendSection(
    editorEl,
    { source: 'properties', label: 'schema' },
    renderTableSchemaContent(componentData, onSave),
  );

  appendSection(
    editorEl,
    { source: 'properties', label: 'data' },
    renderTableDataContent(componentData, onSave),
  );
};
