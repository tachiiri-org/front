import type { FormField } from '../../../schema/component';
import type { FieldStyleContext } from '../../render/editor/context';
import { renderFormFromSchema } from '../../render/editor/form';

const TABLE_PROPERTIES_SCHEMA: FormField[] = [
  { kind: 'text', key: 'name', label: 'name' },
  { kind: 'style', key: 'style', label: 'padding', styleSpecKey: 'padding' },
];

export const renderTablePropertiesContent = (
  componentData: Record<string, unknown>,
  onSave: (patch: Record<string, unknown>) => Promise<void>,
  ctx: FieldStyleContext,
): HTMLElement => {
  const propertiesData: Record<string, unknown> = {
    name: typeof componentData.name === 'string' ? componentData.name : '',
    style:
      typeof componentData.style === 'object' &&
      componentData.style !== null &&
      !Array.isArray(componentData.style)
        ? { ...(componentData.style as Record<string, string>) }
        : {},
  };

  return renderFormFromSchema(
    propertiesData,
    TABLE_PROPERTIES_SCHEMA,
    async (draft) => {
      const d = draft as Record<string, unknown>;
      await onSave({
        name: typeof d.name === 'string' ? d.name : '',
        style:
          typeof d.style === 'object' &&
          d.style !== null &&
          !Array.isArray(d.style)
            ? { ...(d.style as Record<string, string>) }
            : {},
      });
    },
    ctx,
    { saveOnBlur: true },
  );
};
