import type { GraphDocument, GraphText, GraphWord } from '../../../../schema/component/kind/word-graph';

export interface GraphSharedState {
  graphId: string;
  texts: GraphText[];
  words: GraphWord[];
  path: string[];
  pendingFocusId: string | null;
  pendingFocusColumn: number | null;
  pendingFocusCursorPos: number | null;
  focusedId: string | null;
  focusedColumn: number | null;
  saveTimer: ReturnType<typeof setTimeout> | null;
  documents: GraphDocument[];
  documentsTextId: string | null;
  history: { texts: GraphText[]; words: GraphWord[] }[];
  inputCache: Map<string, HTMLTextAreaElement>;
  loaded: boolean;
  subscribers: Set<() => void>;
  lang: 'en' | 'ja';
}

const registry = new Map<string, GraphSharedState>();

export const clearGraphStore = (): void => registry.clear();

export const getOrCreateGraphState = (graphId: string): GraphSharedState => {
  if (!registry.has(graphId)) {
    registry.set(graphId, {
      graphId,
      texts: [],
      words: [],
      path: [],
      pendingFocusId: null,
      pendingFocusColumn: null,
      pendingFocusCursorPos: null,
      focusedId: null,
      focusedColumn: null,
      saveTimer: null,
      documents: [],
      documentsTextId: null,
      history: [],
      inputCache: new Map(),
      loaded: false,
      subscribers: new Set(),
      lang: 'en',
    });
  }
  return registry.get(graphId)!;
};
