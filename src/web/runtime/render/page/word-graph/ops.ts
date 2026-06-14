import type { GraphText, GraphWord } from '../../../../schema/component/kind/word-graph';
import { ALL_CSS_PROP_KEYS } from '../../../../schema/component';

export const getLangText = (item: { en?: string; ja?: string }, lang: 'en' | 'ja'): string => {
  const primary = lang === 'en' ? item.en : item.ja;
  if (primary !== undefined && primary !== '') return primary;
  const fallback = lang === 'en' ? item.ja : item.en;
  return fallback ?? '';
};

export const hasPrimaryLang = (item: { en?: string; ja?: string }, lang: 'en' | 'ja'): boolean => {
  const v = lang === 'en' ? item.en : item.ja;
  return v !== undefined && v !== '';
};

export const setLangText = (item: GraphText | GraphWord, lang: 'en' | 'ja', value: string): void => {
  if (lang === 'en') item.en = value;
  else item.ja = value;
};

export const findWordByText = (words: GraphWord[], text: string): GraphWord | undefined => {
  const lower = text.toLowerCase();
  return words.find(
    (w) => (w.en ?? '').toLowerCase() === lower || (w.ja ?? '').toLowerCase() === lower,
  );
};

export const wordMatchesQuery = (word: GraphWord, q: string): boolean => {
  const lower = q.toLowerCase();
  return (word.en ?? '').toLowerCase().includes(lower) || (word.ja ?? '').toLowerCase().includes(lower);
};

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

export const graphFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  fetch(input, init).then((r) => {
    if (r.status === 401) { window.location.href = '/login'; }
    return r;
  });

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
  const words: GraphWord[] = (raw.words as Array<Record<string, unknown>>).map((w) => {
    const legacyText = w.text !== undefined ? String(w.text) : '';
    const normalized = legacyText === 'task' ? 'goal' : legacyText;
    const en = w.en !== undefined ? String(w.en) : normalized || undefined;
    const ja = w.ja !== undefined ? String(w.ja) : undefined;
    return {
      id: String(w.id),
      ...(en ? { en } : {}),
      ...(ja ? { ja } : {}),
      ...(typeof w.color === 'string' ? { color: w.color } : {}),
    };
  });

  const texts: GraphText[] = (raw.texts as Array<Record<string, unknown>>).map((t) => {
    const legacyText = t.text !== undefined ? String(t.text) : '';
    const en = t.en !== undefined ? String(t.en) : legacyText || undefined;
    const ja = t.ja !== undefined ? String(t.ja) : undefined;
    const wordIds: string[] = Array.isArray(t.wordIds)
      ? (t.wordIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    return {
      id: String(t.id),
      ...(en ? { en } : {}),
      ...(ja ? { ja } : {}),
      wordIds,
    };
  });

  return { texts, words };
};
