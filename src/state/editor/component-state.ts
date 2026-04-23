import { componentCatalog, componentCatalogMap } from '../../catalog/components';
import { moveComponentTree } from '../../spec/editor-document';
import type { ComponentInstance, SpecDocument, ViewportId } from '../../spec/editor-schema';

import { clampFramePosition, clampFrameSize } from './layout-constraints';
import { createId } from './document-options';
import { getViewport, replaceViewport } from './viewport-state';

const collectDescendantIds = (
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

export const addComponent = (
  document: SpecDocument,
  screenId: string,
  viewportId: ViewportId,
  type = 'Text',
  parentId?: string,
): SpecDocument => {
  const definition = componentCatalogMap[type] ?? componentCatalog[0]!;
  const id = createId(type.toLowerCase());
  const component: ComponentInstance = {
    id,
    nameJa: definition.displayNameJa,
    nameEn: id,
    type: definition.type,
    parentId,
    frame: { x: 8, y: 8, w: 24, h: 12 },
    props: definition.defaultProps,
    editorMetadata: { note: '' },
    zIndex: 0,
  };

  return replaceViewport(document, screenId, viewportId, (viewport) => ({
    ...viewport,
    components: [...viewport.components, component],
  }));
};

export const removeComponent = (
  document: SpecDocument,
  screenId: string,
  viewportId: ViewportId,
  componentId: string,
): SpecDocument =>
  replaceViewport(document, screenId, viewportId, (viewport) => {
    const removedIds = collectDescendantIds(viewport.components, componentId);

    return {
      ...viewport,
      components: viewport.components.filter((component) => !removedIds.has(component.id)),
    };
  });

export const updateComponent = (
  document: SpecDocument,
  screenId: string,
  viewportId: ViewportId,
  componentId: string,
  updater: (component: ComponentInstance) => ComponentInstance,
): SpecDocument =>
  replaceViewport(document, screenId, viewportId, (viewport) => ({
    ...viewport,
    components: viewport.components.map((component) =>
      component.id === componentId ? updater(component) : component,
    ),
  }));

export const reparentComponent = (
  document: SpecDocument,
  screenId: string,
  viewportId: ViewportId,
  componentId: string,
  parentId: string | undefined,
): SpecDocument =>
  updateComponent(document, screenId, viewportId, componentId, (component) => ({
    ...component,
    parentId,
  }));

export const outdentComponent = (
  document: SpecDocument,
  screenId: string,
  viewportId: ViewportId,
  componentId: string,
): SpecDocument => {
  const viewport = getViewport(document, screenId, viewportId);
  const component = viewport.components.find((entry) => entry.id === componentId);

  if (!component?.parentId) {
    return document;
  }

  const parent = viewport.components.find((entry) => entry.id === component.parentId);

  return reparentComponent(document, screenId, viewportId, componentId, parent?.parentId);
};

export const reorderComponent = (
  document: SpecDocument,
  screenId: string,
  viewportId: ViewportId,
  componentId: string,
  direction: 'up' | 'down',
): SpecDocument =>
  replaceViewport(document, screenId, viewportId, (viewport) => {
    const currentIndex = viewport.components.findIndex((component) => component.id === componentId);

    if (currentIndex < 0) {
      return viewport;
    }

    const component = viewport.components[currentIndex]!;
    const siblingIndexes = viewport.components
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.parentId === component.parentId)
      .map(({ index }) => index);
    const siblingPosition = siblingIndexes.indexOf(currentIndex);
    const targetSiblingIndex = direction === 'up' ? siblingPosition - 1 : siblingPosition + 1;

    if (targetSiblingIndex < 0 || targetSiblingIndex >= siblingIndexes.length) {
      return viewport;
    }

    const nextComponents = [...viewport.components];
    const swapIndex = siblingIndexes[targetSiblingIndex]!;

    [nextComponents[currentIndex], nextComponents[swapIndex]] = [
      nextComponents[swapIndex]!,
      nextComponents[currentIndex]!,
    ];

    return {
      ...viewport,
      components: nextComponents,
    };
  });

export const moveComponent = (
  document: SpecDocument,
  screenId: string,
  viewportId: ViewportId,
  componentId: string,
  delta: { readonly x: number; readonly y: number },
): SpecDocument =>
  replaceViewport(document, screenId, viewportId, (viewport) => ({
    ...viewport,
    components: moveComponentTree(viewport.components, componentId, delta),
  }));

export const nudgeComponent = (
  document: SpecDocument,
  screenId: string,
  viewportId: ViewportId,
  componentId: string,
  delta: { readonly x: number; readonly y: number },
): SpecDocument =>
  updateComponent(document, screenId, viewportId, componentId, (component) => ({
    ...component,
    frame: {
      ...component.frame,
      x: clampFramePosition(component.frame.x + delta.x),
      y: clampFramePosition(component.frame.y + delta.y),
    },
  }));

export const moveComponentToEdge = (
  document: SpecDocument,
  screenId: string,
  viewportId: ViewportId,
  componentId: string,
  direction: 'left' | 'right' | 'up' | 'down',
): SpecDocument =>
  updateComponent(document, screenId, viewportId, componentId, (component) => ({
    ...component,
    frame: {
      ...component.frame,
      x:
        direction === 'left'
          ? 0
          : direction === 'right'
            ? clampFramePosition(120 - component.frame.w)
            : component.frame.x,
      y:
        direction === 'up'
          ? 0
          : direction === 'down'
            ? clampFramePosition(120 - component.frame.h)
            : component.frame.y,
    },
  }));

export const resizeComponentByKeyboard = (
  document: SpecDocument,
  screenId: string,
  viewportId: ViewportId,
  componentId: string,
  delta: { readonly w: number; readonly h: number },
): SpecDocument =>
  updateComponent(document, screenId, viewportId, componentId, (component) => ({
    ...component,
    frame: {
      ...component.frame,
      w: clampFrameSize(component.frame.w + delta.w),
      h: clampFrameSize(component.frame.h + delta.h),
    },
  }));

export const expandComponentToEdge = (
  document: SpecDocument,
  screenId: string,
  viewportId: ViewportId,
  componentId: string,
  direction: 'left' | 'right' | 'up' | 'down',
): SpecDocument =>
  updateComponent(document, screenId, viewportId, componentId, (component) => {
    const nextFrame = { ...component.frame };

    if (direction === 'left') {
      nextFrame.w = clampFrameSize(component.frame.w + component.frame.x);
      nextFrame.x = 0;
    }

    if (direction === 'right') {
      nextFrame.w = clampFrameSize(120 - component.frame.x);
    }

    if (direction === 'up') {
      nextFrame.h = clampFrameSize(component.frame.h + component.frame.y);
      nextFrame.y = 0;
    }

    if (direction === 'down') {
      nextFrame.h = clampFrameSize(120 - component.frame.y);
    }

    return {
      ...component,
      frame: nextFrame,
    };
  });

export const canAssignParent = (
  components: readonly ComponentInstance[],
  componentId: string,
  nextParentId: string | undefined,
): boolean => {
  if (!nextParentId) {
    return true;
  }

  if (componentId === nextParentId) {
    return false;
  }

  const component = components.find((entry) => entry.id === componentId);
  const parent = components.find((entry) => entry.id === nextParentId);

  if (!component || !parent) {
    return false;
  }

  const parentDefinition = componentCatalogMap[parent.type];

  if (!parentDefinition?.allowsChildren) {
    return false;
  }

  if (
    parentDefinition.allowedChildTypes &&
    !parentDefinition.allowedChildTypes.includes(component.type)
  ) {
    return false;
  }

  return !collectDescendantIds(components, componentId).has(nextParentId);
};
