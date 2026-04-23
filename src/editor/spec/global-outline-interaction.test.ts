import { describe, expect, it } from 'vitest';

import type { SpecNodeDocItem } from '../../spec/editor-schema';

import { getVisibleGlobalItemIds } from './global-outline-interaction';

const createItem = (
  id: string,
  text: string,
  children: readonly SpecNodeDocItem[] = [],
): SpecNodeDocItem => ({
  children: [...children],
  id,
  kind: 'item',
  text,
});

describe('global-outline-interaction', () => {
  it('returns only top-level ids in outline order', () => {
    const items = [createItem('a', 'A', [createItem('b', 'B')]), createItem('c', 'C')];

    expect(getVisibleGlobalItemIds(items, new Set())).toEqual(['a', 'c']);
  });

  it('ignores collapse state because body items do not belong to the sidebar outline', () => {
    const items = [createItem('a', 'A', [createItem('b', 'B')]), createItem('c', 'C')];

    expect(getVisibleGlobalItemIds(items, new Set(['a']))).toEqual(['a', 'c']);
  });
});
