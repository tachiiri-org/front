import type { ComponentDocument, Layout } from './layout';

export type ComponentState = Record<string, unknown>;

export type RootStore = {
  layout: Layout | null;
  components: Map<string, ComponentState>;
  componentDocuments: Map<string, ComponentDocument>;
};

export const createStore = (): RootStore => ({
  layout: null,
  components: new Map(),
  componentDocuments: new Map(),
});
