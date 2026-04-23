import { componentCatalogMap } from '../../catalog/components';

import type { ComponentInstance } from '../editor-schema';

export const validateComponentInstance = (component: ComponentInstance) => {
  const definition = componentCatalogMap[component.type];

  if (!definition) {
    return {
      success: false as const,
      error: [`Unknown component type: ${component.type}`],
    };
  }

  const propsResult = definition.propsSchema.safeParse(component.props);

  if (!propsResult.success) {
    return {
      success: false as const,
      error: propsResult.error.issues.map((issue) => issue.message),
    };
  }

  if (component.parentId) {
    const parent = componentCatalogMap[component.type];

    if (!parent) {
      return {
        success: false as const,
        error: [`Missing parent catalog definition for ${component.type}`],
      };
    }
  }

  return { success: true as const };
};
