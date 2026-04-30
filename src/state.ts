import { createStore } from './store';

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

export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
};
