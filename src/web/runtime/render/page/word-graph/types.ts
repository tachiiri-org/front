import type { GraphText, GraphWord } from '../../../../schema/component/kind/word-graph';

export interface WordGraphState {
  texts: GraphText[];
  words: GraphWord[];
  // path[i] = selected item id in column i (alternating: even=text, odd=word)
  path: string[];
  pendingFocusId: string | null;
  pendingFocusColumn: number | null;
  focusedId: string | null;
  focusedColumn: number | null;
  saveTimer: ReturnType<typeof setTimeout> | null;
  history: { texts: GraphText[]; words: GraphWord[] }[];
  inputCache: Map<string, HTMLTextAreaElement>;
}

export interface WordGraphContext {
  id: string;
  outer: HTMLElement;
  state: WordGraphState;
  scheduleSave: () => void;
  pushHistory: () => void;
  render: () => void;
  scheduleRender: () => void;
}
