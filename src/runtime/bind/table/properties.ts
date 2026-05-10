import type { FormField } from '../../../schema/component';
import { isStyleRecord } from '../../../schema/component';
import type { FieldStyleContext } from '../../render/editor/context';
import { renderFormFromSchema } from '../../render/editor/form';

const TABLE_PROPERTIES_SCHEMA: FormField[] = [
  { kind: 'text', key: 'name', label: 'name' },
  { kind: 'style', key: 'padding', label: 'padding' },
];

export const renderTablePropertiesContent = (
  componentData: Record<string, unknown>,
  onSave: (patch: Record<string, unknown>) => Promise<void>,
  ctx: FieldStyleContext,
): HTMLElement => {
  const propertiesData: Record<string, unknown> = {
    name: typeof componentData.name === 'string' ? componentData.name : '',
    padding: isStyleRecord(componentData.padding) ? { ...componentData.padding } : {},
  };

  return renderFormFromSchema(
    propertiesData,
    TABLE_PROPERTIES_SCHEMA,
    async (draft) => {
      const d = draft as Record<string, unknown>;
      await onSave({
        name: typeof d.name === 'string' ? d.name : '',
        padding: isStyleRecord(d.padding) ? { ...d.padding } : {},
      });
    },
    ctx,
    { saveOnBlur: true },
  );
};
