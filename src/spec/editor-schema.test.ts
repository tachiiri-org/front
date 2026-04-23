import { describe, expect, it } from 'vitest';

import { specDocumentSchema } from './editor-schema';

describe('editor-schema', () => {
  it('normalizes legacy fixed sections into the new outline format', () => {
    const parsed = specDocumentSchema.parse({
      concerns: [{ id: 'ui', nameJa: 'UI', nameEn: 'UI' }],
      screens: [
        {
          id: 'screen-1',
          nameJa: '画面1',
          nameEn: 'Screen 1',
          viewports: {
            desktop: { id: 'desktop', components: [] },
            tablet: { id: 'tablet', components: [] },
            mobile: { id: 'mobile', components: [] },
          },
        },
      ],
      specNodes: [
        {
          id: 'issue-1',
          kind: 'tool',
          titleJa: '論点1',
          titleEn: 'Issue 1',
          order: 0,
          doc: {
            goals: ['Clarify ownership'],
            hints: [],
            constraints: [],
            todos: [],
          },
          links: [],
        },
      ],
      tools: [{ id: 'tool-1', nameJa: 'ツール1', nameEn: 'tool-1' }],
    });

    expect(parsed.specNodes?.[0]?.kind).toBe('tool');
    expect(parsed.specNodes?.[0]?.doc.items).toEqual([
      {
        text: 'Goal',
        id: expect.any(String),
        kind: 'heading',
        headingLevel: 1,
        children: [
          { text: 'Clarify ownership', id: expect.any(String), kind: 'item', children: [] },
        ],
      },
      { text: 'Hint', id: expect.any(String), kind: 'heading', headingLevel: 1, children: [] },
      {
        text: 'Constraint',
        id: expect.any(String),
        kind: 'heading',
        headingLevel: 1,
        children: [],
      },
      { text: 'Todo', id: expect.any(String), kind: 'heading', headingLevel: 1, children: [] },
    ]);
  });

  it('parses the new outline doc format directly', () => {
    const parsed = specDocumentSchema.parse({
      concerns: [{ id: 'ui', nameJa: 'UI', nameEn: 'UI' }],
      screens: [
        {
          id: 'screen-1',
          nameJa: '画面1',
          nameEn: 'Screen 1',
          viewports: {
            desktop: { id: 'desktop', components: [] },
            tablet: { id: 'tablet', components: [] },
            mobile: { id: 'mobile', components: [] },
          },
        },
      ],
      specNodes: [
        {
          id: 'issue-1',
          kind: 'tool',
          titleJa: '論点1',
          titleEn: 'Issue 1',
          order: 0,
          doc: {
            items: [
              {
                text: 'Goal',
                kind: 'heading',
                headingLevel: 2,
                children: [
                  { text: 'Clarify ownership', kind: 'task', status: 'accepted', children: [] },
                ],
              },
            ],
          },
          links: [],
        },
      ],
      tools: [{ id: 'tool-1', nameJa: 'ツール1', nameEn: 'tool-1' }],
    });

    expect(parsed.specNodes?.[0]?.doc.items[0]).toEqual({
      text: 'Goal',
      id: expect.any(String),
      kind: 'heading',
      headingLevel: 2,
      children: [
        {
          text: 'Clarify ownership',
          id: expect.any(String),
          kind: 'task',
          status: 'accepted',
          children: [],
        },
      ],
    });
    expect(parsed.specNodes?.[0]?.doc.items[0]?.children[0]).toEqual({
      text: 'Clarify ownership',
      id: expect.any(String),
      kind: 'task',
      status: 'accepted',
      children: [],
    });
  });

  it('defaults task status to open when omitted', () => {
    const parsed = specDocumentSchema.parse({
      concerns: [{ id: 'ui', nameJa: 'UI', nameEn: 'UI' }],
      screens: [
        {
          id: 'screen-1',
          nameJa: '画面1',
          nameEn: 'Screen 1',
          viewports: {
            desktop: { id: 'desktop', components: [] },
            tablet: { id: 'tablet', components: [] },
            mobile: { id: 'mobile', components: [] },
          },
        },
      ],
      specNodes: [
        {
          id: 'global-node:root',
          kind: 'global',
          titleJa: 'Global',
          titleEn: 'Global',
          order: 0,
          doc: {
            items: [{ text: 'Review policy', kind: 'task', children: [] }],
          },
          links: [],
        },
      ],
      tools: [{ id: 'tool-1', nameJa: 'ツール1', nameEn: 'tool-1' }],
    });

    expect(parsed.specNodes?.[0]?.doc.items[0]).toMatchObject({
      id: expect.any(String),
      kind: 'task',
      status: 'open',
    });
  });

  it('parses independent document issues', () => {
    const parsed = specDocumentSchema.parse({
      concerns: [{ id: 'ui', nameJa: 'UI', nameEn: 'UI' }],
      issues: [
        {
          id: 'issue-1',
          text: 'Clarify ownership',
          status: 'open',
          sourceNodeId: 'global-node:root',
          sourceItemId: 'item-1',
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        },
      ],
      screens: [
        {
          id: 'screen-1',
          nameJa: '画面1',
          nameEn: 'Screen 1',
          viewports: {
            desktop: { id: 'desktop', components: [] },
            tablet: { id: 'tablet', components: [] },
            mobile: { id: 'mobile', components: [] },
          },
        },
      ],
      tools: [{ id: 'tool-1', nameJa: 'ツール1', nameEn: 'tool-1' }],
    });

    expect(parsed.issues).toEqual([
      {
        id: 'issue-1',
        text: 'Clarify ownership',
        status: 'open',
        sourceNodeId: 'global-node:root',
        sourceItemId: 'item-1',
        createdAt: '2026-03-20T00:00:00.000Z',
        updatedAt: '2026-03-20T00:00:00.000Z',
      },
    ]);
  });
});
