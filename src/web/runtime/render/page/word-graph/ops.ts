import type { GraphText, GraphWord } from '../../../../schema/component/kind/word-graph';
import { ALL_CSS_PROP_KEYS } from '../../../../schema/component';

export const randomId = (): string => {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id_${Math.random().toString(36).slice(2, 10)}`;
};

export const cloneData = (
  texts: GraphText[],
  words: GraphWord[],
): { texts: GraphText[]; words: GraphWord[] } =>
  JSON.parse(JSON.stringify({ texts, words })) as { texts: GraphText[]; words: GraphWord[] };

export const applyCssProps = (el: HTMLElement, c: Record<string, unknown>): void => {
  for (const k of ALL_CSS_PROP_KEYS) {
    const v = c[k];
    if (typeof v === 'string') (el.style as unknown as Record<string, string>)[k] = v;
  }
};

export const findText = (texts: GraphText[], id: string): GraphText | undefined =>
  texts.find((t) => t.id === id);

export const findWord = (words: GraphWord[], id: string): GraphWord | undefined =>
  words.find((w) => w.id === id);

// Even columns (0, 2, 4...) are text columns; odd are word columns.
export const isTextColumn = (colIndex: number): boolean => colIndex % 2 === 0;

export const getColumnItems = (
  texts: GraphText[],
  words: GraphWord[],
  path: string[],
  colIndex: number,
): (GraphText | GraphWord)[] => {
  if (colIndex === 0) return [...texts];
  const parentId = path[colIndex - 1];
  if (!parentId) return [];
  if (isTextColumn(colIndex)) {
    // Text column (col > 0): texts that contain the word at path[colIndex-1]
    return texts.filter((t) => t.wordIds.includes(parentId));
  } else {
    // Word column: words of the text at path[colIndex-1]
    const text = findText(texts, parentId);
    if (!text) return [];
    return text.wordIds
      .map((wid) => findWord(words, wid))
      .filter((w): w is GraphWord => w !== undefined);
  }
};

export const getColumnItemIds = (
  texts: GraphText[],
  words: GraphWord[],
  path: string[],
  colIndex: number,
): string[] => getColumnItems(texts, words, path, colIndex).map((item) => item.id);

export const migrateGraphData = (
  raw: { texts: unknown[]; words: unknown[] },
): { texts: GraphText[]; words: GraphWord[] } => {
  const words: GraphWord[] = (raw.words as Array<Record<string, unknown>>).map((w) => ({
    id: String(w.id),
    text: String(w.text),
    ...(typeof w.color === 'string' ? { color: w.color } : {}),
  }));

  const ensureWord = (text: string): string => {
    let w = words.find((x) => x.text === text);
    if (!w) { w = { id: randomId(), text }; words.push(w); }
    return w.id;
  };

  const texts: GraphText[] = (raw.texts as Array<Record<string, unknown>>).map((t) => {
    const wordIds: string[] = Array.isArray(t.wordIds)
      ? (t.wordIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    if (t.type === 'issue') { const id = ensureWord('issue'); if (!wordIds.includes(id)) wordIds.push(id); }
    else if (t.type === 'task') { const id = ensureWord('task'); if (!wordIds.includes(id)) wordIds.push(id); }
    if (t.status === 'proposed') { const id = ensureWord('proposed'); if (!wordIds.includes(id)) wordIds.push(id); }
    return { id: String(t.id), text: String(t.text), wordIds };
  });

  return { texts, words };
};
