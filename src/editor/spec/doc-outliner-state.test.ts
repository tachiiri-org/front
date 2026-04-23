import { describe, expect, it } from 'vitest';

import type { SpecNodeDocItem } from '../../spec/editor-schema';

import {
  flattenDocItems,
  getDocItemAtPath,
  indentDocItems,
  insertDocItemAfterPath,
  insertChildDocItem,
  parsePastedDocItems,
  replaceDocItemWithItems,
  setDocItemChildren,
  outdentDocItems,
  setDocItemHeadingLevel,
  setDocItemKind,
  setDocItemTaskStatus,
  splitDocItem,
} from './doc-outliner-state';

const createItem = (
  text: string,
  children: readonly SpecNodeDocItem[] = [],
  kind: SpecNodeDocItem['kind'] = 'item',
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6,
): SpecNodeDocItem => ({
  text,
  id: `${text || 'item'}-${kind}-${headingLevel ?? 0}`,
  headingLevel: kind === 'heading' ? (headingLevel ?? 1) : undefined,
  kind,
  status: kind === 'task' ? 'open' : undefined,
  children: [...children],
});

describe('doc-outliner-state', () => {
  it('flattens nested items with stable depth and path metadata', () => {
    const entries = flattenDocItems([
      createItem('Goal', [createItem('Child')]),
      createItem('Next'),
    ]);

    expect(entries).toEqual([
      { depth: 0, item: createItem('Goal', [createItem('Child')]), path: [0] },
      { depth: 1, item: createItem('Child'), path: [0, 0] },
      { depth: 0, item: createItem('Next'), path: [1] },
    ]);
  });

  it('indents an item under its previous sibling', () => {
    const items = [createItem('One'), createItem('Two'), createItem('Three')];

    expect(indentDocItems(items, [1])).toEqual([
      createItem('One', [createItem('Two')]),
      createItem('Three'),
    ]);
  });

  it('outdents an item to become a sibling after its parent', () => {
    const items = [createItem('One', [createItem('Two'), createItem('Three')]), createItem('Four')];

    expect(outdentDocItems(items, [0, 1])).toEqual([
      createItem('One', [createItem('Two')]),
      createItem('Three'),
      createItem('Four'),
    ]);
  });

  it('splits an item into two siblings on enter', () => {
    const result = splitDocItem([createItem('Hello world')], [0], 5);

    expect(result.items[0]).toEqual({
      ...createItem('Hello world'),
      text: 'Hello',
    });
    expect(result.items[1]).toMatchObject({
      text: ' world',
      kind: 'item',
      children: [],
    });
    expect(result.items[1]?.id).toEqual(expect.any(String));
    expect(result.focusPath).toEqual([1]);
  });

  it('preserves item kind when splitting headings', () => {
    const result = splitDocItem([createItem('Goal', [], 'heading')], [0], 4);

    expect(result.items).toEqual([
      createItem('Goal', [], 'heading'),
      expect.objectContaining({
        text: '',
        kind: 'heading',
        children: [],
      }),
    ]);
  });

  it('toggles an item to task kind at a path', () => {
    expect(setDocItemKind([createItem('Review')], [0], 'task')).toEqual([
      {
        ...createItem('Review'),
        kind: 'task',
        status: 'open',
      },
    ]);
  });

  it('updates task status without changing task kind', () => {
    expect(setDocItemTaskStatus([createItem('Review', [], 'task')], [0], 'accepted')).toEqual([
      { ...createItem('Review', [], 'task'), status: 'accepted' },
    ]);
  });

  it('sets heading levels and keeps the item as heading', () => {
    expect(setDocItemHeadingLevel([createItem('Goal')], [0], 3)).toEqual([
      {
        ...createItem('Goal'),
        kind: 'heading',
        headingLevel: 3,
      },
    ]);
  });

  it('inserts the first child under an empty heading', () => {
    expect(insertChildDocItem([createItem('Goal', [], 'heading')], [0], createItem(''))).toEqual([
      createItem('Goal', [createItem('')], 'heading'),
    ]);
  });

  it('inserts a sibling item after the given path', () => {
    const inserted = createItem('Inserted');
    const result = insertDocItemAfterPath([createItem('Goal'), createItem('Hint')], [0], inserted);

    expect(result.items).toEqual([createItem('Goal'), inserted, createItem('Hint')]);
    expect(result.focusPath).toEqual([1]);
  });

  it('replaces one item with multiple pasted items', () => {
    const result = replaceDocItemWithItems(
      [createItem('Old'), createItem('After')],
      [0],
      [createItem('New 1'), createItem('New 2')],
    );

    expect(result.items).toEqual([createItem('New 1'), createItem('New 2'), createItem('After')]);
    expect(result.focusPath).toEqual([0]);
  });

  it('replaces the selected item children without touching siblings', () => {
    const items = [
      createItem('File A', [createItem('Old')]),
      createItem('File B', [createItem('Keep')]),
    ];
    const nextChildren = [createItem('New 1'), createItem('New 2')];
    const updated = setDocItemChildren(items, [0], nextChildren);

    expect(getDocItemAtPath(updated, [0])?.children).toEqual(nextChildren);
    expect(getDocItemAtPath(updated, [1])?.children).toEqual([createItem('Keep')]);
  });

  it('parses pasted multiline text into outline items', () => {
    expect(parsePastedDocItems('# Heading\n- child one\n- child two\nPlain line\n## Sub')).toEqual([
      {
        id: expect.any(String),
        text: 'Heading',
        kind: 'heading',
        headingLevel: 1,
        children: [
          { id: expect.any(String), text: 'child one', kind: 'item', children: [] },
          { id: expect.any(String), text: 'child two', kind: 'item', children: [] },
        ],
      },
      { id: expect.any(String), text: 'Plain line', kind: 'item', children: [] },
      {
        id: expect.any(String),
        text: 'Sub',
        kind: 'heading',
        headingLevel: 2,
        children: [],
      },
    ]);
  });
});
