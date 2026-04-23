import { describe, expect, it } from 'vitest';

import type { SpecNode, SpecNodeDocItem } from '../../spec/editor-schema';

import {
  createSelectedGlobalDocumentNode,
  getSelectedGlobalOutlineItemId,
  getSelectedSpecOutlineNodeId,
} from './selected-document';

const globalNode: SpecNode = {
  doc: { items: [] },
  id: 'global-node:root',
  kind: 'global',
  links: [],
  metadata: { managed: 'synced' },
  order: 0,
  titleEn: 'Global',
  titleJa: 'Global',
};

const selectedItem: SpecNodeDocItem = {
  children: [{ children: [], id: 'child-1', kind: 'item', text: 'Pages Functions owns the BFF.' }],
  id: 'item-1',
  kind: 'item',
  text: 'Runtime plan',
};

describe('selected-document helpers', () => {
  it('creates a distinct synthetic document node for a selected global item', () => {
    expect(createSelectedGlobalDocumentNode(globalNode, selectedItem)).toEqual({
      ...globalNode,
      doc: { items: selectedItem.children },
      id: 'global-doc-item:item-1',
      titleEn: 'Runtime plan',
      titleJa: 'Runtime plan',
    });
  });

  it('clears spec-outline selection while a global item is active', () => {
    expect(getSelectedSpecOutlineNodeId('global', 'screen-node:tool-a:screen-1')).toBeNull();
    expect(getSelectedSpecOutlineNodeId('spec', 'screen-node:tool-a:screen-1')).toBe(
      'screen-node:tool-a:screen-1',
    );
  });

  it('clears global-outline selection while a spec node is active', () => {
    expect(getSelectedGlobalOutlineItemId('spec', 'item-1')).toBeNull();
    expect(getSelectedGlobalOutlineItemId('global', 'item-1')).toBe('item-1');
  });
});
