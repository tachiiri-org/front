import type { ComponentInstance } from '../../spec/editor-schema';

export const editorBounds = { x: 0, y: 0, w: 120, h: 120 } as const;

export const clampFrameWithinBounds = (
  frame: ComponentInstance['frame'],
  bounds: ComponentInstance['frame'] | typeof editorBounds,
): ComponentInstance['frame'] => {
  const w = Math.max(1, Math.min(bounds.w, frame.w));
  const h = Math.max(1, Math.min(bounds.h, frame.h));
  const maxX = bounds.x + bounds.w - w;
  const maxY = bounds.y + bounds.h - h;

  return {
    ...frame,
    w,
    h,
    x: Math.max(bounds.x, Math.min(maxX, frame.x)),
    y: Math.max(bounds.y, Math.min(maxY, frame.y)),
  };
};

export const normalizeViewportComponents = (
  components: readonly ComponentInstance[],
): ComponentInstance[] => {
  const componentMap = new Map(components.map((component) => [component.id, component]));
  const normalizedMap = new Map<string, ComponentInstance>();

  const normalizeComponent = (component: ComponentInstance): ComponentInstance => {
    const cached = normalizedMap.get(component.id);

    if (cached) {
      return cached;
    }

    const parent = component.parentId ? componentMap.get(component.parentId) : undefined;
    const parentBounds = parent ? normalizeComponent(parent).frame : editorBounds;
    const normalized = {
      ...component,
      frame: clampFrameWithinBounds(component.frame, parentBounds),
    };

    normalizedMap.set(component.id, normalized);

    return normalized;
  };

  return components.map((component) => normalizeComponent(component));
};

export const clampFramePosition = (value: number): number => Math.max(0, Math.min(119, value));

export const clampFrameSize = (value: number): number => Math.max(1, Math.min(120, value));
