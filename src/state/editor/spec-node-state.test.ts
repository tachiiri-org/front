import { describe, expect, it } from 'vitest';

import type { SpecDocument } from '../../spec/editor-schema';
import { createDefaultSpecNodeDoc } from '../../spec/spec-node-doc';
import {
  addSpecNode,
  addTraceLink,
  removeSpecNode,
  reorderSpecNode,
  updateSpecNode,
  updateTraceLink,
} from './index';

const createDocument = (): SpecDocument => ({
  concerns: [{ id: 'local-store', nameJa: 'local-store', nameEn: 'local-store' }],
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
      doc: createDefaultSpecNodeDoc(),
      id: 'global-node:root',
      kind: 'global',
      links: [],
      metadata: { managed: 'synced' },
      order: 0,
      titleEn: 'Global',
      titleJa: 'Global',
    },
    {
      doc: createDefaultSpecNodeDoc(),
      id: 'tool-node:tool-1',
      kind: 'tool',
      links: [],
      metadata: { managed: 'synced', toolId: 'tool-1' },
      order: 0,
      titleEn: 'tool1',
      titleJa: 'ツール1',
    },
    {
      doc: createDefaultSpecNodeDoc(),
      id: 'concern-node:tool-1:local-store',
      kind: 'concern',
      links: [],
      metadata: { concernId: 'local-store', managed: 'synced', toolId: 'tool-1' },
      order: 0,
      parentId: 'tool-node:tool-1',
      titleEn: 'local-store',
      titleJa: 'local-store',
    },
  ],
  tools: [{ id: 'tool-1', nameJa: 'ツール1', nameEn: 'tool1' }],
});

describe('spec-node-state', () => {
  it('adds a manual child node under the selected parent', () => {
    const updated = addSpecNode(createDocument(), 'issue', 'concern-node:tool-1:local-store');
    const added = updated.specNodes?.find((node) => node.kind === 'issue');

    expect(added?.parentId).toBe('concern-node:tool-1:local-store');
    expect(added?.metadata?.managed).toBe('manual');
    expect(added?.metadata?.toolId).toBe('tool-1');
    expect(added?.doc.items).toEqual([]);
  });

  it('removes a node subtree', () => {
    const withChildren = {
      ...createDocument(),
      specNodes: [
        ...(createDocument().specNodes ?? []),
        {
          doc: createDefaultSpecNodeDoc(),
          id: 'issue-1',
          kind: 'issue' as const,
          links: [],
          metadata: { managed: 'manual' as const, toolId: 'tool-1' },
          order: 0,
          parentId: 'concern-node:tool-1:local-store',
          titleEn: 'Issue 1',
          titleJa: '論点1',
        },
        {
          doc: createDefaultSpecNodeDoc(),
          id: 'todo-1',
          kind: 'todo' as const,
          links: [],
          metadata: { managed: 'manual' as const, toolId: 'tool-1' },
          order: 0,
          parentId: 'issue-1',
          titleEn: 'Todo 1',
          titleJa: 'TODO1',
        },
      ],
    };

    const updated = removeSpecNode(withChildren, 'issue-1');

    expect(updated.specNodes?.map((node) => node.id)).toEqual([
      'global-node:root',
      'tool-node:tool-1',
      'concern-node:tool-1:local-store',
    ]);
  });

  it('reorders sibling nodes', () => {
    const base = createDocument();
    const first = addSpecNode(base, 'issue', 'concern-node:tool-1:local-store');
    const second = addSpecNode(first, 'contract', 'concern-node:tool-1:local-store');
    const issueNode = second.specNodes?.find((node) => node.kind === 'issue');
    const contractNode = second.specNodes?.find((node) => node.kind === 'contract');

    const updated = reorderSpecNode(second, contractNode?.id ?? '', 'up');

    const siblings = updated.specNodes
      ?.filter((node) => node.parentId === 'concern-node:tool-1:local-store')
      .sort((left, right) => left.order - right.order)
      .map((node) => node.kind);

    expect(issueNode).toBeTruthy();
    expect(siblings).toEqual(['contract', 'issue']);
  });

  it('updates node docs and trace links', () => {
    const withIssue = addSpecNode(createDocument(), 'issue', 'concern-node:tool-1:local-store');
    const issueNode = withIssue.specNodes?.find((node) => node.kind === 'issue');
    const withDoc = updateSpecNode(withIssue, issueNode?.id ?? '', (node) => ({
      ...node,
      doc: {
        items: [
          {
            text: 'Goal',
            kind: 'heading',
            children: [{ text: 'Clarify ownership', kind: 'item', children: [] }],
          },
        ],
      },
    }));
    const withLink = addTraceLink(withDoc, issueNode?.id ?? '', 'file');
    const linkId =
      withLink.specNodes?.find((node) => node.id === issueNode?.id)?.links[0]?.id ?? '';
    const updated = updateTraceLink(withLink, issueNode?.id ?? '', linkId, (link) => ({
      ...link,
      label: 'editor-screen',
      target: 'src/renderer/src/screens/editor/editor-screen.tsx',
    }));

    expect(updated.specNodes?.find((node) => node.id === issueNode?.id)?.doc.items).toEqual([
      {
        text: 'Goal',
        kind: 'heading',
        children: [{ text: 'Clarify ownership', kind: 'item', children: [] }],
      },
    ]);
    expect(updated.specNodes?.find((node) => node.id === issueNode?.id)?.links[0]).toMatchObject({
      kind: 'file',
      label: 'editor-screen',
      target: 'src/renderer/src/screens/editor/editor-screen.tsx',
    });
  });
});
