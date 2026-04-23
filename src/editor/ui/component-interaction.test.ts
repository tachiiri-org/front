import { describe, expect, it } from 'vitest';

import type { ComponentInstance } from '../../spec/editor-schema';

import {
  getOutlineHierarchyAction,
  getOutlineMoveDirection,
  getVisibleComponentIds,
  isOutlineAddShortcut,
} from './component-interaction';

const components: ComponentInstance[] = [
  {
    id: 'page',
    nameJa: 'ページ',
    nameEn: 'page',
    type: 'Page',
    frame: { x: 0, y: 0, w: 120, h: 120 },
    props: {},
    editorMetadata: { note: '' },
    zIndex: 0,
  },
  {
    id: 'header',
    nameJa: 'ヘッダー',
    nameEn: 'header',
    type: 'Header',
    parentId: 'page',
    frame: { x: 0, y: 0, w: 120, h: 20 },
    props: {},
    editorMetadata: { note: '' },
    zIndex: 1,
  },
  {
    id: 'button',
    nameJa: 'ボタン',
    nameEn: 'button',
    type: 'Button',
    parentId: 'header',
    frame: { x: 0, y: 0, w: 20, h: 8 },
    props: {},
    editorMetadata: { note: '' },
    zIndex: 2,
  },
];

describe('component-outline-state', () => {
  it('returns visible ids in outline order', () => {
    expect(getVisibleComponentIds(components, new Set())).toEqual(['page', 'header', 'button']);
  });

  it('omits descendants of collapsed nodes', () => {
    expect(getVisibleComponentIds(components, new Set(['header']))).toEqual(['page', 'header']);
  });

  it('uses shift+alt+arrow for outline reordering', () => {
    expect(
      getOutlineMoveDirection('ArrowUp', { altKey: true, ctrlKey: false, shiftKey: true }),
    ).toBe('up');
    expect(
      getOutlineMoveDirection('ArrowDown', { altKey: true, ctrlKey: false, shiftKey: true }),
    ).toBe('down');
    expect(
      getOutlineMoveDirection('ArrowUp', { altKey: true, ctrlKey: true, shiftKey: false }),
    ).toBeNull();
  });

  it('uses tab and shift+tab for hierarchy changes', () => {
    expect(
      getOutlineHierarchyAction('Tab', { altKey: false, ctrlKey: false, shiftKey: false }),
    ).toBe('indent');
    expect(
      getOutlineHierarchyAction('Tab', { altKey: false, ctrlKey: false, shiftKey: true }),
    ).toBe('outdent');
    expect(
      getOutlineHierarchyAction('Tab', { altKey: false, ctrlKey: true, shiftKey: false }),
    ).toBeNull();
  });

  it('uses ctrl+enter to add a sibling component', () => {
    expect(isOutlineAddShortcut('Enter', { altKey: false, ctrlKey: true, shiftKey: false })).toBe(
      true,
    );
    expect(isOutlineAddShortcut('Enter', { altKey: false, ctrlKey: true, shiftKey: true })).toBe(
      false,
    );
  });
});
