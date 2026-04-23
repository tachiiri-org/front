import { describe, expect, it } from 'vitest';

import type { SpecDocument } from '../../spec/editor-schema';

import {
  addComponent,
  expandComponentToEdge,
  moveComponentToEdge,
  nudgeComponent,
  outdentComponent,
  reorderComponent,
  reparentComponent,
  resizeComponentByKeyboard,
} from './component-state';

const createDocument = (): SpecDocument => ({
  concerns: [{ id: 'concern-1', nameJa: '関心1', nameEn: 'concern1' }],
  tools: [{ id: 'tool-1', nameJa: 'ツール1', nameEn: 'tool1' }],
  screens: [
    {
      id: 'screen-1',
      nameJa: '画面1',
      nameEn: 'Screen 1',
      viewports: {
        desktop: {
          id: 'desktop',
          components: [
            {
              id: 'component-1',
              nameJa: 'カード',
              nameEn: 'card',
              type: 'Card',
              frame: { x: 10, y: 12, w: 24, h: 18 },
              props: {},
              editorMetadata: { note: '' },
              zIndex: 0,
            },
          ],
        },
        tablet: { id: 'tablet', components: [] },
        mobile: { id: 'mobile', components: [] },
      },
    },
  ],
});

describe('editor-state keyboard transforms', () => {
  it('adds a text component by default with z-index 0', () => {
    const updated = addComponent(createDocument(), 'screen-1', 'desktop');
    const added = updated.screens[0]?.viewports.desktop.components.at(-1);

    expect(added?.type).toBe('Text');
    expect(added?.zIndex).toBe(0);
  });

  it('nudges a selected component by one grid unit', () => {
    const moved = nudgeComponent(createDocument(), 'screen-1', 'desktop', 'component-1', {
      x: -1,
      y: 1,
    });

    expect(moved.screens[0]?.viewports.desktop.components[0]?.frame).toEqual({
      x: 9,
      y: 13,
      w: 24,
      h: 18,
    });
  });

  it('clamps keyboard movement within the 120x120 frame', () => {
    const baseDocument = createDocument();
    const screen = baseDocument.screens[0]!;
    const component = screen.viewports.desktop.components[0]!;
    const document: SpecDocument = {
      ...baseDocument,
      screens: [
        {
          ...screen,
          viewports: {
            ...screen.viewports,
            desktop: {
              ...screen.viewports.desktop,
              components: [{ ...component, frame: { x: 0, y: 119, w: 24, h: 18 } }],
            },
          },
        },
      ],
    };

    const moved = nudgeComponent(document, 'screen-1', 'desktop', 'component-1', {
      x: -1,
      y: 1,
    });

    expect(moved.screens[0]?.viewports.desktop.components[0]?.frame).toEqual({
      x: 0,
      y: 102,
      w: 24,
      h: 18,
    });
  });

  it('resizes a selected component with shift+arrow semantics', () => {
    const resized = resizeComponentByKeyboard(
      createDocument(),
      'screen-1',
      'desktop',
      'component-1',
      { w: 1, h: -1 },
    );

    expect(resized.screens[0]?.viewports.desktop.components[0]?.frame).toEqual({
      x: 10,
      y: 12,
      w: 25,
      h: 17,
    });
  });

  it('clamps keyboard resize within minimum and maximum bounds', () => {
    const baseDocument = createDocument();
    const screen = baseDocument.screens[0]!;
    const component = screen.viewports.desktop.components[0]!;
    const document: SpecDocument = {
      ...baseDocument,
      screens: [
        {
          ...screen,
          viewports: {
            ...screen.viewports,
            desktop: {
              ...screen.viewports.desktop,
              components: [{ ...component, frame: { x: 10, y: 12, w: 1, h: 120 } }],
            },
          },
        },
      ],
    };

    const resized = resizeComponentByKeyboard(document, 'screen-1', 'desktop', 'component-1', {
      w: -1,
      h: 1,
    });

    expect(resized.screens[0]?.viewports.desktop.components[0]?.frame).toEqual({
      x: 10,
      y: 0,
      w: 1,
      h: 120,
    });
  });

  it('reparents a component under another component', () => {
    const baseDocument = createDocument();
    const screen = baseDocument.screens[0]!;
    const sibling: SpecDocument = {
      ...baseDocument,
      screens: [
        {
          ...screen,
          viewports: {
            ...screen.viewports,
            desktop: {
              ...screen.viewports.desktop,
              components: [
                ...screen.viewports.desktop.components,
                {
                  id: 'component-2',
                  nameJa: '見出し',
                  nameEn: 'heading',
                  type: 'Heading',
                  frame: { x: 4, y: 4, w: 30, h: 12 },
                  props: {},
                  editorMetadata: { note: '' },
                  zIndex: 1,
                },
              ],
            },
          },
        },
      ],
    };

    const updated = reparentComponent(sibling, 'screen-1', 'desktop', 'component-2', 'component-1');

    expect(updated.screens[0]?.viewports.desktop.components[1]?.parentId).toBe('component-1');
  });

  it('clamps a child component inside its parent bounds when reparented', () => {
    const baseDocument = createDocument();
    const screen = baseDocument.screens[0]!;
    const nested: SpecDocument = {
      ...baseDocument,
      screens: [
        {
          ...screen,
          viewports: {
            ...screen.viewports,
            desktop: {
              ...screen.viewports.desktop,
              components: [
                {
                  id: 'parent',
                  nameJa: 'パネル',
                  nameEn: 'panel',
                  type: 'Panel',
                  frame: { x: 20, y: 20, w: 30, h: 20 },
                  props: { title: 'Panel', tone: 'default' },
                  editorMetadata: { note: '' },
                  zIndex: 0,
                },
                {
                  id: 'child',
                  nameJa: 'ボタン',
                  nameEn: 'button',
                  type: 'Button',
                  frame: { x: 70, y: 70, w: 18, h: 12 },
                  props: { title: 'Button', emphasis: 'primary' },
                  editorMetadata: { note: '' },
                  zIndex: 1,
                },
              ],
            },
          },
        },
      ],
    };

    const updated = reparentComponent(nested, 'screen-1', 'desktop', 'child', 'parent');

    expect(updated.screens[0]?.viewports.desktop.components[1]?.frame).toEqual({
      x: 32,
      y: 28,
      w: 18,
      h: 12,
    });
  });

  it('reorders sibling components upward', () => {
    const baseDocument = createDocument();
    const screen = baseDocument.screens[0]!;
    const sibling: SpecDocument = {
      ...baseDocument,
      screens: [
        {
          ...screen,
          viewports: {
            ...screen.viewports,
            desktop: {
              ...screen.viewports.desktop,
              components: [
                ...screen.viewports.desktop.components,
                {
                  id: 'component-2',
                  nameJa: '見出し',
                  nameEn: 'heading',
                  type: 'Heading',
                  frame: { x: 4, y: 4, w: 30, h: 12 },
                  props: {},
                  editorMetadata: { note: '' },
                  zIndex: 1,
                },
              ],
            },
          },
        },
      ],
    };

    const updated = reorderComponent(sibling, 'screen-1', 'desktop', 'component-2', 'up');

    expect(updated.screens[0]?.viewports.desktop.components[0]?.id).toBe('component-2');
    expect(updated.screens[0]?.viewports.desktop.components[1]?.id).toBe('component-1');
  });

  it('outdents a component to its grandparent level', () => {
    const baseDocument = createDocument();
    const screen = baseDocument.screens[0]!;
    const nested: SpecDocument = {
      ...baseDocument,
      screens: [
        {
          ...screen,
          viewports: {
            ...screen.viewports,
            desktop: {
              ...screen.viewports.desktop,
              components: [
                ...screen.viewports.desktop.components,
                {
                  id: 'component-2',
                  nameJa: '見出し',
                  nameEn: 'heading',
                  type: 'Heading',
                  parentId: 'component-1',
                  frame: { x: 4, y: 4, w: 30, h: 12 },
                  props: {},
                  editorMetadata: { note: '' },
                  zIndex: 1,
                },
                {
                  id: 'component-3',
                  nameJa: 'ボタン',
                  nameEn: 'button',
                  type: 'Button',
                  parentId: 'component-2',
                  frame: { x: 6, y: 8, w: 12, h: 8 },
                  props: {},
                  editorMetadata: { note: '' },
                  zIndex: 2,
                },
              ],
            },
          },
        },
      ],
    };

    const updated = outdentComponent(nested, 'screen-1', 'desktop', 'component-3');

    expect(updated.screens[0]?.viewports.desktop.components[2]?.parentId).toBe('component-1');
  });

  it('expands a component to the nearest canvas edge', () => {
    const expandedLeft = expandComponentToEdge(
      createDocument(),
      'screen-1',
      'desktop',
      'component-1',
      'left',
    );
    const expandedDown = expandComponentToEdge(
      createDocument(),
      'screen-1',
      'desktop',
      'component-1',
      'down',
    );

    expect(expandedLeft.screens[0]?.viewports.desktop.components[0]?.frame).toEqual({
      x: 0,
      y: 12,
      w: 34,
      h: 18,
    });
    expect(expandedDown.screens[0]?.viewports.desktop.components[0]?.frame).toEqual({
      x: 10,
      y: 12,
      w: 24,
      h: 108,
    });
  });

  it('moves a component directly to the nearest canvas edge', () => {
    const movedRight = moveComponentToEdge(
      createDocument(),
      'screen-1',
      'desktop',
      'component-1',
      'right',
    );
    const movedUp = moveComponentToEdge(
      createDocument(),
      'screen-1',
      'desktop',
      'component-1',
      'up',
    );

    expect(movedRight.screens[0]?.viewports.desktop.components[0]?.frame).toEqual({
      x: 96,
      y: 12,
      w: 24,
      h: 18,
    });
    expect(movedUp.screens[0]?.viewports.desktop.components[0]?.frame).toEqual({
      x: 10,
      y: 0,
      w: 24,
      h: 18,
    });
  });
});
