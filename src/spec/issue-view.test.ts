import { describe, expect, it } from 'vitest';

import { createEmptySpecDocument, loadSpecDocument } from './editor-document';
import {
  createIssueFromDocItem,
  collectIssueEntries,
  formatIssueShareText,
  groupIssueEntriesByStatus,
  moveIssueEntry,
  removeIssueEntry,
  updateIssueEntry,
} from './issue-view';

describe('issue-view', () => {
  it('collects global and selected-tool issues into flat issue entries', () => {
    const document = loadSpecDocument({
      ...createEmptySpecDocument(),
      issues: [
        {
          id: 'global-1',
          text: 'Global issue',
          status: 'open',
          sourceNodeId: 'global-node:root',
          sourceItemId: 'item-1',
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        },
        {
          id: 'tool-1',
          text: 'UI issue',
          status: 'proposed',
          sourceNodeId: 'concern-node:ui-spec-editor:ui',
          sourceItemId: 'item-2',
          componentId: 'component-1',
          screenId: 'screen-1',
          toolId: 'ui-spec-editor',
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        },
      ],
    });

    const entries = collectIssueEntries(document, 'ui-spec-editor');

    expect(entries.map((entry) => entry.text)).toEqual(['Global issue', 'UI issue']);
    expect(entries.map((entry) => entry.sourceNodeTitleJa)).toEqual(['Global', 'local-store']);
  });

  it('groups entries by status buckets', () => {
    const grouped = groupIssueEntriesByStatus([
      {
        id: 'a',
        createdAt: '',
        updatedAt: '',
        sourceItemId: 'item-a',
        sourceNodeId: 'global-node:root',
        sourceNodePath: ['Global'],
        sourceNodeTitleJa: 'Global',
        status: 'open',
        text: 'A',
      },
      {
        id: 'b',
        createdAt: '',
        updatedAt: '',
        sourceItemId: 'item-b',
        sourceNodeId: 'tool-node:tool-1',
        sourceNodePath: ['ツール'],
        sourceNodeTitleJa: 'ツール',
        status: 'done',
        text: 'B',
        toolId: 'tool-1',
      },
    ]);

    expect(grouped.open).toHaveLength(1);
    expect(grouped.done).toHaveLength(1);
    expect(grouped.proposed).toHaveLength(0);
  });

  it('formats issue share text with source context', () => {
    const text = formatIssueShareText({
      id: 'issue-1',
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:00.000Z',
      sourceItemId: 'item-1',
      sourceNodeId: 'component-node:hero',
      sourceNodePath: ['Global', 'Screen', 'Hero'],
      sourceNodeTitleJa: 'Hero',
      sourceLinkLabel: 'hero.tsx',
      sourceLinkTarget: 'src/renderer/src/components/hero.tsx',
      status: 'open',
      text: 'CTA copy is unclear',
      screenId: 'checkout-screen',
      componentId: 'hero-cta',
      toolId: 'ui-spec-editor',
    });

    expect(text).toContain('Issue: issue-1');
    expect(text).toContain('Status: open');
    expect(text).toContain('Text: CTA copy is unclear');
    expect(text).toContain('Source: Global / Screen / Hero');
    expect(text).toContain('Source Node ID: component-node:hero');
    expect(text).toContain('Data: SpecDocument.issues');
    expect(text).toContain('Linked Data: src/renderer/src/components/hero.tsx');
    expect(text).toContain('Linked Label: hero.tsx');
    expect(text).toContain('Source Item: item-1');
    expect(text).toContain('Screen: checkout-screen');
    expect(text).toContain('Component: hero-cta');
    expect(text).toContain('Tool: ui-spec-editor');
  });

  it('updates issue text and status in document issues', () => {
    const document = loadSpecDocument({
      ...createEmptySpecDocument(),
      specNodes: [
        {
          id: 'global-node:root',
          kind: 'global',
          titleJa: 'Global',
          titleEn: 'Global',
          order: 0,
          links: [],
          doc: {
            items: [{ id: 'item-1', text: 'Initial', kind: 'item', children: [] }],
          },
        },
      ],
      issues: [
        {
          id: 'issue-1',
          text: 'Initial',
          status: 'open',
          sourceNodeId: 'global-node:root',
          sourceItemId: 'item-1',
          componentId: 'component-1',
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        },
      ],
    });

    const updated = updateIssueEntry(document, 'issue-1', () => ({
      status: 'accepted',
      text: 'Updated',
    }));

    expect(updated.issues?.[0]).toMatchObject({
      id: 'issue-1',
      text: 'Updated',
      status: 'accepted',
    });
    expect(
      updated.specNodes?.find((node) => node.id === 'global-node:root')?.doc.items[0],
    ).toMatchObject({
      id: 'item-1',
      kind: 'task',
      text: 'Updated',
      status: 'accepted',
    });
  });

  it('moves an issue to another status and position', () => {
    const document = loadSpecDocument({
      ...createEmptySpecDocument(),
      specNodes: [
        {
          id: 'global-node:root',
          kind: 'global',
          titleJa: 'Global',
          titleEn: 'Global',
          order: 0,
          links: [],
          doc: {
            items: [
              { id: 'item-1', text: 'First', kind: 'item', children: [] },
              { id: 'item-2', text: 'Second', kind: 'item', children: [] },
              { id: 'item-3', text: 'Third', kind: 'item', children: [] },
            ],
          },
        },
      ],
      issues: [
        {
          id: 'first',
          text: 'First',
          status: 'open',
          sourceNodeId: 'global-node:root',
          sourceItemId: 'item-1',
          screenId: 'screen-1',
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        },
        {
          id: 'second',
          text: 'Second',
          status: 'open',
          sourceNodeId: 'global-node:root',
          sourceItemId: 'item-2',
          componentId: 'component-2',
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        },
        {
          id: 'third',
          text: 'Third',
          status: 'done',
          sourceNodeId: 'global-node:root',
          sourceItemId: 'item-3',
          componentId: 'component-3',
          screenId: 'screen-1',
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        },
      ],
    });

    const moved = moveIssueEntry(document, 'first', 'done', 1);

    expect(moved.issues?.map((issue) => `${issue.status}:${issue.text}`)).toEqual([
      'open:Second',
      'done:Third',
      'done:First',
    ]);
    expect(
      moved.specNodes?.find((node) => node.id === 'global-node:root')?.doc.items[0],
    ).toMatchObject({
      id: 'item-1',
      kind: 'task',
      status: 'done',
    });
  });

  it('removes an issue entry', () => {
    const document = loadSpecDocument({
      ...createEmptySpecDocument(),
      specNodes: [
        {
          id: 'global-node:root',
          kind: 'global',
          titleJa: 'Global',
          titleEn: 'Global',
          order: 0,
          links: [],
          doc: {
            items: [
              { id: 'item-1', text: 'Keep', kind: 'item', children: [] },
              { id: 'item-2', text: 'Delete me', kind: 'item', children: [] },
            ],
          },
        },
      ],
      issues: [
        {
          id: 'keep',
          text: 'Keep',
          status: 'open',
          sourceNodeId: 'global-node:root',
          sourceItemId: 'item-1',
          componentId: 'component-1',
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        },
        {
          id: 'delete',
          text: 'Delete me',
          status: 'open',
          sourceNodeId: 'global-node:root',
          sourceItemId: 'item-2',
          componentId: 'component-2',
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        },
      ],
    });

    const updated = removeIssueEntry(document, 'delete');

    expect(updated.issues?.map((issue) => issue.text)).toEqual(['Keep']);
    expect(
      updated.specNodes?.find((node) => node.id === 'global-node:root')?.doc.items[1],
    ).toMatchObject({
      id: 'item-2',
      kind: 'item',
      status: undefined,
    });
  });

  it('creates an issue from a spec item and keeps the source row', () => {
    const document = loadSpecDocument({
      ...createEmptySpecDocument(),
      specNodes: [
        {
          id: 'component-node:ui-spec-editor:main-screen:desktop:hero-cta',
          kind: 'component',
          titleJa: 'CTA',
          titleEn: 'CTA',
          order: 0,
          links: [],
          metadata: {
            toolId: 'ui-spec-editor',
            screenId: 'main-screen',
            viewportId: 'desktop',
            componentId: 'hero-cta',
          },
          doc: {
            items: [
              {
                id: 'heading-1',
                text: 'Topic',
                kind: 'heading',
                headingLevel: 1,
                children: [
                  {
                    id: 'item-1',
                    text: 'Extract me',
                    kind: 'item',
                    children: [],
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    const sourceNode = document.specNodes?.find(
      (node) => node.id === 'component-node:ui-spec-editor:main-screen:desktop:hero-cta',
    );
    const sourceItem = sourceNode?.doc.items[0]?.children[0];

    expect(sourceNode).toBeTruthy();
    expect(sourceItem).toBeTruthy();

    const created = createIssueFromDocItem(document, sourceNode!.id, sourceItem!.id!);

    expect(created.issues).toHaveLength(1);
    expect(created.issues?.[0]).toMatchObject({
      text: 'Extract me',
      sourceNodeId: sourceNode!.id,
      sourceItemId: sourceItem!.id,
      status: 'open',
      toolId: 'ui-spec-editor',
      screenId: 'main-screen',
      componentId: 'hero-cta',
    });
    expect(
      created.specNodes?.find((node) => node.id === sourceNode!.id)?.doc.items[0]?.children,
    ).toEqual([
      {
        id: 'item-1',
        text: 'Extract me',
        kind: 'task',
        status: 'open',
        children: [],
      },
    ]);
  });

  it('does not create duplicate issues for the same source row', () => {
    const document = loadSpecDocument({
      ...createEmptySpecDocument(),
      specNodes: [
        {
          id: 'global-node:root',
          kind: 'global',
          titleJa: 'Global',
          titleEn: 'Global',
          order: 0,
          links: [],
          doc: {
            items: [{ id: 'item-1', text: 'Keep me', kind: 'item', children: [] }],
          },
        },
      ],
    });

    const first = createIssueFromDocItem(document, 'global-node:root', 'item-1');
    const second = createIssueFromDocItem(first, 'global-node:root', 'item-1');

    expect(first.issues).toHaveLength(1);
    expect(second.issues).toHaveLength(1);
    expect(
      second.specNodes?.find((node) => node.id === 'global-node:root')?.doc.items[0],
    ).toMatchObject({
      id: 'item-1',
      kind: 'task',
      status: 'open',
    });
  });
});
