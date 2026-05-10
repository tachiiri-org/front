import { isTableSchema } from '../../../schema/component';
import { renderJsonEditorRow } from '../../render/editor/json-editor';

export const validateTableSchemaDraft = (draft: unknown): string | null => {
  if (!isTableSchema(draft)) return 'Invalid table schema.';
  const keys = new Set<string>();
  for (const column of draft.columns) {
    if (!column.key.trim()) return 'Column key is required.';
    if (keys.has(column.key)) return `Duplicate column key: ${column.key}`;
    keys.add(column.key);
  }
  return null;
};

export const renderTableSchemaContent = (
  componentData: Record<string, unknown>,
  onSave: (patch: Record<string, unknown>) => Promise<void>,
): HTMLElement =>
  renderJsonEditorRow(
    'schema',
    componentData.schema ?? { version: 1, columns: [] },
    validateTableSchemaDraft,
    async (draft) => {
      await onSave({ schema: draft });
    },
  );
