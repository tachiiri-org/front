import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SpecNodeDocOutliner, isCreateIssueShortcut } from './doc-outliner';

const node = {
  doc: {
    items: [
      {
        children: [],
        id: 'item-1',
        kind: 'item' as const,
        text: 'Shared context',
      },
    ],
  },
  id: 'global-node:root',
  kind: 'global' as const,
  links: [],
  metadata: {},
  order: 0,
  parentId: undefined,
  titleEn: 'Global',
  titleJa: 'Global',
};

describe('doc-outliner shortcuts', () => {
  it('uses shift+i to create an issue', () => {
    expect(
      isCreateIssueShortcut({
        altKey: false,
        ctrlKey: false,
        key: 'I',
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe(true);
    expect(
      isCreateIssueShortcut({
        altKey: false,
        ctrlKey: false,
        key: 'T',
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe(false);
  });
});

describe('SpecNodeDocOutliner', () => {
  it('does not render inline issue buttons', () => {
    const markup = renderToStaticMarkup(
      <SpecNodeDocOutliner
        node={node}
        onActivate={() => {}}
        onChange={(updater) => updater(node.doc)}
        onCreateIssue={() => {}}
        onRenameTitle={() => {}}
      />,
    );

    expect(markup).not.toContain('Issue');
  });

  it('renders task rows with an unchecked checkbox control', () => {
    const markup = renderToStaticMarkup(
      <SpecNodeDocOutliner
        node={{
          ...node,
          doc: {
            items: [
              {
                children: [],
                id: 'item-1',
                kind: 'task',
                status: 'open',
                text: 'Shared context',
              },
            ],
          },
        }}
        onActivate={() => {}}
        onChange={(updater) =>
          updater({
            items: [
              {
                children: [],
                id: 'item-1',
                kind: 'task',
                status: 'open',
                text: 'Shared context',
              },
            ],
          })
        }
        onClearIssue={() => {}}
        onRenameTitle={() => {}}
      />,
    );

    expect(markup).toContain('type="checkbox"');
    expect(markup).not.toContain('checked=""');
  });

  it('renders an empty-state add action when there are no rows', () => {
    const markup = renderToStaticMarkup(
      <SpecNodeDocOutliner
        node={{ ...node, doc: { items: [] } }}
        onActivate={() => {}}
        onChange={(updater) => updater({ items: [] })}
        onRenameTitle={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Add first item"');
    expect(markup).not.toContain('Click to add the first item');
  });

  it('renders the title as read-only when requested', () => {
    const markup = renderToStaticMarkup(
      <SpecNodeDocOutliner
        node={node}
        onActivate={() => {}}
        onChange={(updater) => updater(node.doc)}
        onRenameTitle={() => {}}
        readonlyTitle
      />,
    );

    expect(markup).toContain('readOnly=""');
  });
});
