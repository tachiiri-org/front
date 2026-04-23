import { describe, expect, it } from 'vitest';

import { normalizeGlobalSpecNodeDocForOutline } from './spec-node-doc';

describe('spec-node-doc', () => {
  it('flattens legacy global default headings into outline items', () => {
    const normalized = normalizeGlobalSpecNodeDocForOutline({
      items: [
        {
          text: 'Goal',
          id: 'goal',
          kind: 'heading',
          headingLevel: 1,
          children: [{ text: 'Shared rule', id: 'rule', kind: 'item', children: [] }],
        },
        {
          text: 'Hint',
          id: 'hint',
          kind: 'heading',
          headingLevel: 1,
          children: [],
        },
        {
          text: 'Custom heading',
          id: 'custom',
          kind: 'heading',
          headingLevel: 2,
          children: [],
        },
      ],
    });

    expect(normalized.items).toEqual([
      { text: 'Shared rule', id: 'rule', kind: 'item', children: [] },
      {
        text: 'Custom heading',
        id: 'custom',
        kind: 'heading',
        headingLevel: 2,
        children: [],
      },
    ]);
  });
});
