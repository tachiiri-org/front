import type { Screen } from './schema/screen/screen';
import type { Component } from './schema/component';

export type FrameState = Record<string, unknown>;

type RootStore = {
  screen: Screen | null;
  frameStates: Map<string, FrameState>;
  frameComponents: Map<string, Component>;
};

const createStore = (): RootStore => ({
  screen: null,
  frameStates: new Map(),
  frameComponents: new Map(),
});

export const store = createStore();
export const domMap = new Map<string, HTMLElement>();

export const getFrameSelection = (frameId: string): string | null => {
  const state = store.frameStates.get(frameId);
  if (!state) return null;
  return typeof state.selectedValue === 'string' ? state.selectedValue : null;
};

export const setFrameSelection = (frameId: string, value: string): void => {
  const current = store.frameStates.get(frameId) ?? {};
  store.frameStates.set(frameId, { ...current, selectedValue: value });
};

export const clearFrameSelection = (frameId: string): void => {
  const current = store.frameStates.get(frameId) ?? {};
  store.frameStates.set(frameId, { ...current, selectedValue: undefined });
};

export type CanvasSelection =
  | { kind: 'canvas' }
  | { kind: 'frame'; id: string }
  | null;

export const getCanvasSelection = (frameId: string): CanvasSelection => {
  const v = getFrameSelection(frameId);
  if (v === null) return null;
  if (v === '') return { kind: 'canvas' };
  return { kind: 'frame', id: v };
};

export const setCanvasSelection = (frameId: string, value: CanvasSelection): void => {
  if (value === null) {
    const current = store.frameStates.get(frameId) ?? {};
    store.frameStates.set(frameId, { ...current, selectedValue: undefined });
  } else if (value.kind === 'canvas') {
    setFrameSelection(frameId, '');
  } else {
    setFrameSelection(frameId, value.id);
  }
};

export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
};
