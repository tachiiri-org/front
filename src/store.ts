import type { Screen } from './screen';
import type { Component } from './component';

export type FrameState = Record<string, unknown>;

export type RootStore = {
  screen: Screen | null;
  frameStates: Map<string, FrameState>;
  frameComponents: Map<string, Component>;
};

export const createStore = (): RootStore => ({
  screen: null,
  frameStates: new Map(),
  frameComponents: new Map(),
});
