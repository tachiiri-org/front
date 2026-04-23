import type { ComponentDefinition } from './shared';
import { contentComponents } from './content';
import { inputComponents } from './input';
import { mediaComponents } from './media';
import { structureComponents } from './structure';

export type { ComponentDefinition, PropField } from './shared';

export const componentCatalog = [
  ...structureComponents,
  ...contentComponents,
  ...inputComponents,
  ...mediaComponents,
] as const satisfies readonly ComponentDefinition[];

export const componentCatalogMap = Object.fromEntries(
  componentCatalog.map((definition) => [definition.type, definition]),
) as Record<string, ComponentDefinition>;
