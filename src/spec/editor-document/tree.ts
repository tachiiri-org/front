import type { ComponentInstance, ViewportId, ViewportSpec } from '../editor-schema';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const copyViewport = (viewport: ViewportSpec, nextViewportId: ViewportId): ViewportSpec => ({
  id: nextViewportId,
  components: clone(viewport.components),
});

export const collectDescendantIds = (
  components: readonly ComponentInstance[],
  componentId: string,
  ids = new Set<string>([componentId]),
): Set<string> => {
  for (const component of components) {
    if (component.parentId && ids.has(component.parentId) && !ids.has(component.id)) {
      ids.add(component.id);
      collectDescendantIds(components, component.id, ids);
    }
  }

  return ids;
};

export const moveComponentTree = (
  components: readonly ComponentInstance[],
  componentId: string,
  delta: { readonly x: number; readonly y: number },
): ComponentInstance[] => {
  const descendantIds = collectDescendantIds(components, componentId);

  return components.map((component) =>
    descendantIds.has(component.id)
      ? {
          ...component,
          frame: {
            ...component.frame,
            x: component.frame.x + delta.x,
            y: component.frame.y + delta.y,
          },
        }
      : component,
  );
};
