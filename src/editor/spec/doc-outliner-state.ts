import type { SpecNodeDocItem } from '../../spec/editor-schema';
import { createDocItem, createEmptyDocItem, createHeadingDocItem } from '../../spec/spec-node-doc';

export type DocItemPath = readonly number[];

export type FlattenedDocItem = {
  readonly depth: number;
  readonly item: SpecNodeDocItem;
  readonly path: DocItemPath;
};

const updateArrayAtPath = (
  items: readonly SpecNodeDocItem[],
  arrayPath: DocItemPath,
  updater: (items: readonly SpecNodeDocItem[]) => readonly SpecNodeDocItem[],
): SpecNodeDocItem[] => {
  if (arrayPath.length === 0) {
    return [...updater(items)];
  }

  const [index, ...rest] = arrayPath;
  const current = items[index];

  if (!current) {
    return [...items];
  }

  return items.map((item, itemIndex) =>
    itemIndex === index
      ? {
          ...item,
          children: updateArrayAtPath(item.children, rest, updater),
        }
      : item,
  );
};

export const getDocItemAtPath = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
): SpecNodeDocItem | null => {
  let currentItems = items;
  let currentItem: SpecNodeDocItem | null = null;

  for (const index of path) {
    currentItem = currentItems[index] ?? null;

    if (!currentItem) {
      return null;
    }

    currentItems = currentItem.children;
  }

  return currentItem;
};

export const flattenDocItems = (
  items: readonly SpecNodeDocItem[],
  depth = 0,
  parentPath: DocItemPath = [],
): FlattenedDocItem[] =>
  items.flatMap((item, index) => {
    const path = [...parentPath, index];

    return [{ depth, item, path }, ...flattenDocItems(item.children, depth + 1, path)];
  });

export const setDocItemText = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
  text: string,
): SpecNodeDocItem[] => {
  const item = getDocItemAtPath(items, path);

  if (!item) {
    return [...items];
  }

  return updateArrayAtPath(items, path.slice(0, -1), (siblings) =>
    siblings.map((entry, index) => (index === path[path.length - 1] ? { ...entry, text } : entry)),
  );
};

export const setDocItemChildren = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
  children: readonly SpecNodeDocItem[],
): SpecNodeDocItem[] => {
  const item = getDocItemAtPath(items, path);

  if (!item) {
    return [...items];
  }

  return updateArrayAtPath(items, path.slice(0, -1), (siblings) =>
    siblings.map((entry, index) =>
      index === path[path.length - 1] ? { ...entry, children: [...children] } : entry,
    ),
  );
};

export const removeDocItem = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
): SpecNodeDocItem[] =>
  updateArrayAtPath(items, path.slice(0, -1), (siblings) =>
    siblings.filter((_, index) => index !== path[path.length - 1]),
  );

export const insertDocItemAfterPath = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
  item: SpecNodeDocItem,
): { readonly focusPath: DocItemPath; readonly items: SpecNodeDocItem[] } => {
  if (path.length === 0) {
    return { items: [...items, item], focusPath: [items.length] };
  }

  const nextItems = updateArrayAtPath(items, path.slice(0, -1), (siblings) => {
    const nextSiblings = [...siblings];
    const index = path[path.length - 1]!;
    nextSiblings.splice(index + 1, 0, item);
    return nextSiblings;
  });

  return {
    items: nextItems,
    focusPath: [...path.slice(0, -1), path[path.length - 1]! + 1],
  };
};

export const replaceDocItemWithItems = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
  replacements: readonly SpecNodeDocItem[],
): { readonly focusPath: DocItemPath; readonly items: SpecNodeDocItem[] } => {
  if (path.length === 0 || replacements.length === 0) {
    return { items: [...items], focusPath: path };
  }

  const nextItems = updateArrayAtPath(items, path.slice(0, -1), (siblings) => {
    const nextSiblings = [...siblings];
    const index = path[path.length - 1]!;
    nextSiblings.splice(index, 1, ...replacements);
    return nextSiblings;
  });

  return {
    items: nextItems,
    focusPath: [...path.slice(0, -1), path[path.length - 1]!],
  };
};

export const parsePastedDocItems = (text: string): SpecNodeDocItem[] => {
  const roots: SpecNodeDocItem[] = [];
  let currentParent: SpecNodeDocItem | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);

    if (headingMatch) {
      const [, hashes, title] = headingMatch;
      const nextItem = createHeadingDocItem(
        title.trim(),
        [],
        hashes.length as 1 | 2 | 3 | 4 | 5 | 6,
      );
      roots.push(nextItem);
      currentParent = nextItem;
      continue;
    }

    const bulletMatch = /^-\s+(.*)$/.exec(line);

    if (bulletMatch) {
      const nextItem = createDocItem(bulletMatch[1]!.trim());

      if (currentParent) {
        currentParent.children.push(nextItem);
      } else {
        roots.push(nextItem);
        currentParent = nextItem;
      }

      continue;
    }

    const nextItem = createDocItem(line);
    roots.push(nextItem);
    currentParent = nextItem;
  }

  return roots;
};

export const splitDocItem = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
  cursorOffset: number,
): { readonly focusPath: DocItemPath; readonly items: SpecNodeDocItem[] } => {
  const item = getDocItemAtPath(items, path);

  if (!item) {
    return { items: [...items], focusPath: path };
  }

  const nextItems = updateArrayAtPath(items, path.slice(0, -1), (siblings) => {
    const before = item.text.slice(0, cursorOffset);
    const after = item.text.slice(cursorOffset);
    const nextSiblings = [...siblings];
    const index = path[path.length - 1];

    nextSiblings.splice(
      index,
      1,
      { ...item, text: before },
      {
        text: after,
        id: globalThis.crypto.randomUUID(),
        kind: item.kind,
        headingLevel: item.headingLevel,
        status: item.kind === 'task' ? (item.status ?? 'open') : undefined,
        children: [],
      },
    );
    return nextSiblings;
  });

  return {
    items: nextItems,
    focusPath: [...path.slice(0, -1), path[path.length - 1]! + 1],
  };
};

export const indentDocItems = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
): SpecNodeDocItem[] => {
  const index = path[path.length - 1];

  if (path.length === 0 || index === 0) {
    return [...items];
  }

  return updateArrayAtPath(items, path.slice(0, -1), (siblings) => {
    const current = siblings[index];
    const previous = siblings[index - 1];

    if (!current || !previous) {
      return siblings;
    }

    const nextSiblings = [...siblings];
    nextSiblings.splice(index, 1);
    nextSiblings[index - 1] = {
      ...previous,
      children: [...previous.children, current],
    };
    return nextSiblings;
  });
};

export const getIndentedPath = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
): DocItemPath => {
  const index = path[path.length - 1];

  if (path.length === 0 || index === 0) {
    return path;
  }

  const previous = getDocItemAtPath(items, [...path.slice(0, -1), index - 1]);

  return previous ? [...path.slice(0, -1), index - 1, previous.children.length] : path;
};

export const outdentDocItems = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
): SpecNodeDocItem[] => {
  if (path.length < 2) {
    return [...items];
  }

  const parentIndex = path[path.length - 2]!;
  const childIndex = path[path.length - 1]!;

  return updateArrayAtPath(items, path.slice(0, -2), (siblings) => {
    const parent = siblings[parentIndex];
    const child = parent?.children[childIndex];

    if (!parent || !child) {
      return siblings;
    }

    const nextSiblings = [...siblings];
    nextSiblings[parentIndex] = {
      ...parent,
      children: parent.children.filter((_, index) => index !== childIndex),
    };
    nextSiblings.splice(parentIndex + 1, 0, child);
    return nextSiblings;
  });
};

export const getOutdentedPath = (path: DocItemPath): DocItemPath =>
  path.length < 2 ? path : [...path.slice(0, -2), path[path.length - 2]! + 1];

export const moveDocItem = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
  direction: 'up' | 'down',
): SpecNodeDocItem[] => {
  const index = path[path.length - 1];
  const nextIndex = direction === 'up' ? index - 1 : index + 1;

  if (path.length === 0 || index < 0 || nextIndex < 0) {
    return [...items];
  }

  return updateArrayAtPath(items, path.slice(0, -1), (siblings) => {
    if (nextIndex >= siblings.length) {
      return siblings;
    }

    const nextSiblings = [...siblings];
    [nextSiblings[index], nextSiblings[nextIndex]] = [nextSiblings[nextIndex], nextSiblings[index]];
    return nextSiblings;
  });
};

export const getMovedPath = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
  direction: 'up' | 'down',
): DocItemPath => {
  const index = path[path.length - 1];
  const nextIndex = direction === 'up' ? index - 1 : index + 1;

  if (path.length === 0 || nextIndex < 0) {
    return path;
  }

  const siblingsPath = path.slice(0, -1);
  const parent =
    siblingsPath.length === 0 ? { children: items } : getDocItemAtPath(items, siblingsPath);
  const siblings = parent?.children ?? [];

  return nextIndex >= siblings.length ? path : [...siblingsPath, nextIndex];
};

export const setDocItemKind = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
  kind: SpecNodeDocItem['kind'],
): SpecNodeDocItem[] => {
  const item = getDocItemAtPath(items, path);

  if (!item || item.kind === kind) {
    return [...items];
  }

  return updateArrayAtPath(items, path.slice(0, -1), (siblings) =>
    siblings.map((entry, index) =>
      index === path[path.length - 1]
        ? {
            ...entry,
            kind,
            headingLevel: kind === 'heading' ? (entry.headingLevel ?? 1) : undefined,
            status: kind === 'task' ? 'open' : undefined,
          }
        : entry,
    ),
  );
};

export const setDocItemTaskStatus = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
  status: NonNullable<SpecNodeDocItem['status']>,
): SpecNodeDocItem[] => {
  const item = getDocItemAtPath(items, path);

  if (!item || item.kind !== 'task') {
    return [...items];
  }

  return updateArrayAtPath(items, path.slice(0, -1), (siblings) =>
    siblings.map((entry, index) =>
      index === path[path.length - 1] ? { ...entry, status } : entry,
    ),
  );
};

export const setDocItemHeadingLevel = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
  headingLevel: 1 | 2 | 3 | 4 | 5 | 6,
): SpecNodeDocItem[] => {
  const item = getDocItemAtPath(items, path);

  if (!item) {
    return [...items];
  }

  return updateArrayAtPath(items, path.slice(0, -1), (siblings) =>
    siblings.map((entry, index) =>
      index === path[path.length - 1] ? { ...entry, kind: 'heading', headingLevel } : entry,
    ),
  );
};

export const insertChildDocItem = (
  items: readonly SpecNodeDocItem[],
  path: DocItemPath,
  child: SpecNodeDocItem,
): SpecNodeDocItem[] => updateArrayAtPath(items, path, (children) => [...children, child]);

export { createEmptyDocItem };
