import type {
  SpecNodeDoc,
  SpecNodeDocHeadingLevel,
  SpecNodeDocItem,
  SpecNodeDocItemKind,
  SpecNodeTaskStatus,
} from './editor-schema';

type LegacySpecNodeDoc = {
  readonly constraints?: readonly (string | SpecNodeDocItem)[];
  readonly goals?: readonly (string | SpecNodeDocItem)[];
  readonly hints?: readonly (string | SpecNodeDocItem)[];
  readonly todos?: readonly (string | SpecNodeDocItem)[];
};

const createDocItemId = (): string => globalThis.crypto.randomUUID();

const normalizeDocItem = (item: string | SpecNodeDocItem): SpecNodeDocItem =>
  typeof item === 'string'
    ? { text: item, id: createDocItemId(), kind: 'item', children: [] }
    : {
        text: item.text,
        id: item.id ?? createDocItemId(),
        headingLevel: item.kind === 'heading' ? (item.headingLevel ?? 1) : undefined,
        kind: item.kind,
        status: item.kind === 'task' ? (item.status ?? 'open') : undefined,
        children: item.children.map(normalizeDocItem),
      };

export const createDocItem = (
  text = '',
  kind: SpecNodeDocItemKind = 'item',
  children: readonly SpecNodeDocItem[] = [],
  headingLevel?: SpecNodeDocHeadingLevel,
  status?: SpecNodeTaskStatus,
): SpecNodeDocItem => ({
  text,
  id: createDocItemId(),
  headingLevel: kind === 'heading' ? (headingLevel ?? 1) : undefined,
  kind,
  status: kind === 'task' ? (status ?? 'open') : undefined,
  children: [...children],
});

export const createEmptyDocItem = (): SpecNodeDocItem => createDocItem();

export const createHeadingDocItem = (
  text: string,
  children: readonly SpecNodeDocItem[] = [],
  headingLevel: SpecNodeDocHeadingLevel = 1,
): SpecNodeDocItem => createDocItem(text, 'heading', children, headingLevel);

export const createDefaultSpecNodeDoc = (): SpecNodeDoc => ({
  items: [],
});

export const createSpecNodeDocFromLegacySections = (
  doc?: LegacySpecNodeDoc | null,
): SpecNodeDoc => ({
  items: [
    createHeadingDocItem('Goal', (doc?.goals ?? []).map(normalizeDocItem)),
    createHeadingDocItem('Hint', (doc?.hints ?? []).map(normalizeDocItem)),
    createHeadingDocItem('Constraint', (doc?.constraints ?? []).map(normalizeDocItem)),
    createHeadingDocItem('Todo', (doc?.todos ?? []).map(normalizeDocItem)),
  ],
});

export const normalizeSpecNodeDocItemsForEditing = (
  items: readonly SpecNodeDocItem[],
): SpecNodeDocItem[] =>
  items.map((item) => ({
    text: item.text,
    id: item.id ?? createDocItemId(),
    headingLevel: item.kind === 'heading' ? (item.headingLevel ?? 1) : undefined,
    kind: item.kind,
    status: item.kind === 'task' ? (item.status ?? 'open') : undefined,
    children: normalizeSpecNodeDocItemsForEditing(item.children),
  }));

export const normalizeSpecNodeDocForEditing = (doc: SpecNodeDoc): SpecNodeDoc => ({
  items: normalizeSpecNodeDocItemsForEditing(doc.items),
});

const defaultGlobalSectionTitles = new Set(['Goal', 'Hint', 'Constraint', 'Todo']);

export const normalizeGlobalSpecNodeDocForOutline = (doc: SpecNodeDoc): SpecNodeDoc => ({
  items: normalizeSpecNodeDocItemsForEditing(doc.items).flatMap((item) =>
    item.kind === 'heading' && defaultGlobalSectionTitles.has(item.text) ? item.children : [item],
  ),
});

export const hasRenderableDocItems = (items: readonly SpecNodeDocItem[]): boolean =>
  items.some((item) => item.text.trim().length > 0 || hasRenderableDocItems(item.children));

export const findDocItemPathById = (
  items: readonly SpecNodeDocItem[],
  itemId: string,
  parentPath: readonly number[] = [],
): readonly number[] | null => {
  for (const [index, item] of items.entries()) {
    const path = [...parentPath, index];

    if (item.id === itemId) {
      return path;
    }

    const nested = findDocItemPathById(item.children, itemId, path);

    if (nested) {
      return nested;
    }
  }

  return null;
};
