import { describe, expect, it } from 'vitest';

import {
  buildSpecNodeContext,
  copyViewport,
  createEmptySpecDocument,
  exportSpecNodeContextPrompt,
  exportPromptDocument,
  getDefaultSelectedSpecNodeId,
  getGlobalSpecNode,
  loadSpecDocument,
  moveComponentTree,
  validateComponentInstance,
} from './editor-document';
import { viewportDisplayPresets, type ComponentInstance, type ViewportSpec } from './editor-schema';

const createViewport = (): ViewportSpec => ({
  id: 'desktop',
  components: [
    {
      id: 'footer',
      nameJa: 'フッター',
      nameEn: 'footer',
      type: 'Footer',
      frame: { x: 0, y: 100, w: 120, h: 20 },
      props: { tone: 'default' },
      editorMetadata: { note: '' },
      zIndex: 0,
    },
    {
      id: 'save-button',
      nameJa: '保存ボタン',
      nameEn: 'saveButton',
      type: 'Button',
      parentId: 'footer',
      frame: { x: 90, y: 104, w: 20, h: 8 },
      props: { title: '保存', emphasis: 'primary' },
      editorMetadata: { note: '' },
      zIndex: 1,
    },
  ],
});

describe('editor-document', () => {
  it('creates an empty spec document with independent viewports', () => {
    const document = createEmptySpecDocument();

    expect(document.screens).toHaveLength(1);
    expect(document.screens[0]?.viewports.desktop.components).toEqual([]);
    expect(document.screens[0]?.viewports.tablet.components).toEqual([]);
    expect(document.screens[0]?.viewports.mobile.components).toEqual([]);
    expect(document.screens[0]?.viewports.desktop).not.toBe(document.screens[0]?.viewports.tablet);
  });

  it('copies a viewport with deep-cloned component instances', () => {
    const source = createViewport();
    const copied = copyViewport(source, 'tablet');

    expect(copied.id).toBe('tablet');
    expect(copied.components).toEqual(source.components);
    expect(copied.components).not.toBe(source.components);
    expect(copied.components[0]).not.toBe(source.components[0]);

    copied.components[0] = {
      ...copied.components[0]!,
      nameJa: '別のフッター',
    };

    expect(source.components[0]?.nameJa).toBe('フッター');
  });

  it('moves a parent and all descendants while preserving absolute coordinates', () => {
    const viewport = createViewport();

    const moved = moveComponentTree(viewport.components, 'footer', { x: 5, y: -2 });

    expect(moved.find((component) => component.id === 'footer')?.frame).toEqual({
      x: 5,
      y: 98,
      w: 120,
      h: 20,
    });
    expect(moved.find((component) => component.id === 'save-button')?.frame).toEqual({
      x: 95,
      y: 102,
      w: 20,
      h: 8,
    });
  });

  it('validates component props against the component catalog', () => {
    const validButton: ComponentInstance = {
      id: 'button',
      nameJa: 'ボタン',
      nameEn: 'button',
      type: 'Button',
      frame: { x: 10, y: 10, w: 20, h: 8 },
      props: { title: '保存', emphasis: 'primary' },
      editorMetadata: { note: '' },
      zIndex: 0,
    };
    const invalidButton: ComponentInstance = {
      ...validButton,
      props: { title: 10, emphasis: 'unknown' },
    };

    expect(validateComponentInstance(validButton).success).toBe(true);
    expect(validateComponentInstance(invalidButton).success).toBe(false);
  });

  it('exports a prompt-friendly summary for AI collaboration', () => {
    const document = createEmptySpecDocument();
    document.screens[0]!.viewports.desktop = createViewport();

    const exported = exportPromptDocument(document);

    expect(exported).toContain('# UI Spec Prompt');
    expect(exported).toContain('Screen: Main Screen');
    expect(exported).toContain('Viewport: desktop');
    expect(exported).toContain('- Footer "footer" / "フッター"');
    expect(exported).toContain('- Button "saveButton" / "保存ボタン"');
  });

  it('normalizes legacy text props to title-based fields on load', () => {
    const loaded = loadSpecDocument({
      ...createEmptySpecDocument(),
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
                  id: 'header',
                  nameJa: 'ヘッダー',
                  nameEn: 'header',
                  type: 'Header',
                  frame: { x: 0, y: 0, w: 60, h: 20 },
                  props: { title: 'Main', subtitle: 'Legacy subtitle' },
                  editorMetadata: { note: '' },
                  zIndex: 0,
                },
                {
                  id: 'button',
                  nameJa: 'ボタン',
                  nameEn: 'button',
                  type: 'Button',
                  frame: { x: 10, y: 30, w: 20, h: 8 },
                  props: { label: 'Save', emphasis: 'primary' },
                  editorMetadata: { note: '' },
                  zIndex: 1,
                },
              ],
            },
            tablet: { id: 'tablet', components: [] },
            mobile: { id: 'mobile', components: [] },
          },
        },
      ],
    });

    expect(loaded.screens[0]?.viewports.desktop.components[0]?.props).toMatchObject({
      title: 'Main\nLegacy subtitle',
    });
    expect(loaded.screens[0]?.viewports.desktop.components[1]?.props).toMatchObject({
      title: 'Save',
    });
  });

  it('migrates legacy concern and tool options on load', () => {
    const loaded = loadSpecDocument({
      concerns: [
        { id: 'visual', nameJa: '見た目', nameEn: 'Visual' },
        { id: 'content', nameJa: '文言', nameEn: 'Content' },
      ],
      tools: [
        { id: 'layout-editor', nameJa: 'レイアウト編集', nameEn: 'Layout Editor' },
        { id: 'diagnostics', nameJa: '診断', nameEn: 'Diagnostics' },
      ],
      screens: createEmptySpecDocument().screens,
    });

    expect(loaded.concerns).toEqual([
      { id: 'local-store', nameJa: 'local-store', nameEn: 'local-store' },
      { id: 'content', nameJa: '文言', nameEn: 'Content' },
    ]);
    expect(loaded.tools).toEqual([
      { id: 'layout-editor', nameJa: 'レイアウト編集', nameEn: 'Layout Editor' },
      { id: 'diagnostics', nameJa: '診断', nameEn: 'Diagnostics' },
    ]);
  });

  it('creates synced tool and structure nodes when loading a legacy document', () => {
    const loaded = loadSpecDocument({
      concerns: [
        { id: 'ui', nameJa: 'UI', nameEn: 'UI' },
        { id: 'content', nameJa: '文言', nameEn: 'Content' },
      ],
      tools: [{ id: 'ui-spec-editor', nameJa: 'ui-spec-editor', nameEn: 'ui-spec-editor' }],
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

    expect(
      loaded.specNodes?.some((node) => node.kind === 'global' && node.titleJa === 'Global'),
    ).toBe(true);
    expect(
      loaded.specNodes?.some(
        (node) =>
          node.kind === 'tool' &&
          node.metadata?.toolId === 'ui-spec-editor' &&
          node.titleJa === 'ui-spec-editor',
      ),
    ).toBe(true);
    expect(
      loaded.specNodes?.some(
        (node) =>
          node.kind === 'concern' &&
          node.metadata?.toolId === 'ui-spec-editor' &&
          node.titleJa === 'local-store',
      ),
    ).toBe(true);
    expect(
      loaded.specNodes?.some(
        (node) => node.kind === 'screen' && node.metadata?.screenId === 'screen-1',
      ),
    ).toBe(true);
    expect(
      loaded.specNodes?.some(
        (node) =>
          node.kind === 'component' &&
          node.metadata?.screenId === 'screen-1' &&
          node.metadata?.viewportId === 'desktop' &&
          node.metadata?.componentId === 'component-1',
      ),
    ).toBe(true);
  });

  it('builds a spec-node context prompt for the selected node', () => {
    const document = loadSpecDocument(createEmptySpecDocument());
    const concernId =
      document.specNodes?.find(
        (node) => node.kind === 'concern' && node.metadata?.toolId === document.tools[0]?.id,
      )?.id ?? null;
    const context = buildSpecNodeContext(document, concernId);
    const exported = exportSpecNodeContextPrompt(document, concernId);

    expect(context?.selectedNode.kind).toBe('concern');
    expect(context?.path).toEqual(['ui-spec-editor', 'local-store']);
    expect(exported).toContain('# Spec Node Context');
    expect(exported).toContain('## Global Context');
    expect(exported).toContain('Node: concern / local-store / local-store');
  });

  it('keeps legacy manual spec nodes under the default tool root', () => {
    const loaded = loadSpecDocument({
      ...createEmptySpecDocument(),
      specNodes: [
        {
          id: 'file:issue:smoke',
          kind: 'issue',
          titleJa: 'electron-smoke.spec.ts',
          titleEn: 'electron-smoke.spec.ts',
          parentId: 'concern-node:issue',
          order: 0,
          doc: { goals: [], hints: [], constraints: [], todos: [] },
          links: [],
        },
      ],
    });

    const issueNode = loaded.specNodes?.find((node) => node.id === 'file:issue:smoke');

    expect(issueNode?.parentId).toBe(`concern-node:${loaded.tools[0]?.id}:issue`);
    expect(issueNode?.metadata?.toolId).toBe(loaded.tools[0]?.id);
  });

  it('exports tool shared tasks before node-local outline', () => {
    const document = loadSpecDocument(createEmptySpecDocument());
    const toolId = document.tools[0]!.id;
    const toolNodeId = `tool-node:${toolId}`;
    const concernId = `concern-node:${toolId}:local-store`;
    const documentWithTasks = {
      ...document,
      specNodes: (document.specNodes ?? []).map((node) => {
        if (node.id === toolNodeId) {
          return {
            ...node,
            doc: {
              items: [
                {
                  text: 'Goal',
                  kind: 'heading' as const,
                  headingLevel: 1 as const,
                  children: [{ text: 'Share across tool', kind: 'task' as const, children: [] }],
                },
              ],
            },
          };
        }

        if (node.id === concernId) {
          return {
            ...node,
            doc: {
              items: [
                {
                  text: 'Goal',
                  kind: 'heading' as const,
                  headingLevel: 1 as const,
                  children: [{ text: 'Local concern task', kind: 'task' as const, children: [] }],
                },
              ],
            },
          };
        }

        return node;
      }),
    };

    const exported = exportSpecNodeContextPrompt(documentWithTasks, concernId);

    expect(exported).toContain('## Global Context');
    expect(exported).toContain('## Tool Shared Context');
    expect(exported.indexOf('Share across tool')).toBeLessThan(
      exported.indexOf('Local concern task'),
    );
  });

  it('migrates legacy local-store concern references on load', () => {
    const loaded = loadSpecDocument({
      concerns: [{ id: 'ui', nameJa: 'UI', nameEn: 'UI' }],
      issues: [
        {
          id: 'issue-1',
          text: 'Stored locally',
          status: 'open',
          sourceNodeId: 'concern-node:ui-spec-editor:ui',
          sourceItemId: 'item-1',
          toolId: 'ui-spec-editor',
          createdAt: '2026-03-21T00:00:00.000Z',
          updatedAt: '2026-03-21T00:00:00.000Z',
        },
      ],
      screens: createEmptySpecDocument().screens,
      specNodes: [
        {
          id: 'concern-node:ui-spec-editor:ui',
          kind: 'concern',
          titleJa: 'UI',
          titleEn: 'UI',
          order: 0,
          parentId: 'tool-node:ui-spec-editor',
          doc: { items: [] },
          links: [
            {
              id: 'concern-link:ui-spec-editor:ui',
              kind: 'contract',
              label: 'UI',
              target: 'ui',
            },
          ],
          metadata: { concernId: 'ui', managed: 'synced', toolId: 'ui-spec-editor' },
        },
        {
          id: 'manual-child',
          kind: 'issue',
          titleJa: 'spec-document.json',
          titleEn: 'spec-document.json',
          order: 0,
          parentId: 'concern-node:ui-spec-editor:ui',
          doc: { items: [] },
          links: [],
          metadata: { managed: 'manual', toolId: 'ui-spec-editor' },
        },
      ],
      tools: [{ id: 'ui-spec-editor', nameJa: 'ui-spec-editor', nameEn: 'ui-spec-editor' }],
    });

    expect(
      loaded.specNodes?.some((node) => node.id === 'concern-node:ui-spec-editor:local-store'),
    ).toBe(true);
    expect(loaded.specNodes?.find((node) => node.id === 'manual-child')?.parentId).toBe(
      'concern-node:ui-spec-editor:local-store',
    );
    expect(loaded.issues?.[0]?.sourceNodeId).toBe('concern-node:ui-spec-editor:local-store');
  });

  it('creates a global node in the synced document', () => {
    const document = loadSpecDocument(createEmptySpecDocument());

    expect(getGlobalSpecNode(document)?.id).toBe('global-node:root');
    expect(getGlobalSpecNode(document)?.kind).toBe('global');
  });

  it('migrates empty default doc headings out of existing spec nodes on load', () => {
    const loaded = loadSpecDocument({
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
              { id: 'goal', text: 'Goal', kind: 'heading', headingLevel: 1, children: [] },
              {
                id: 'hint',
                text: 'Hint',
                kind: 'heading',
                headingLevel: 1,
                children: [{ id: 'hint-item', text: 'Keep this', kind: 'item', children: [] }],
              },
            ],
          },
        },
        {
          id: 'manual-node',
          kind: 'issue',
          titleJa: 'Issue',
          titleEn: 'Issue',
          order: 0,
          parentId: 'tool-node:ui-spec-editor',
          links: [],
          metadata: { managed: 'manual', toolId: 'ui-spec-editor' },
          doc: {
            items: [
              {
                id: 'constraint',
                text: 'Constraint',
                kind: 'heading',
                headingLevel: 1,
                children: [],
              },
              { id: 'custom', text: 'Custom', kind: 'heading', headingLevel: 2, children: [] },
            ],
          },
        },
      ],
    });

    expect(loaded.specNodes?.find((node) => node.id === 'global-node:root')?.doc.items).toEqual([
      {
        id: 'hint',
        text: 'Hint',
        kind: 'heading',
        headingLevel: 1,
        children: [{ id: 'hint-item', text: 'Keep this', kind: 'item', children: [] }],
      },
    ]);
    expect(loaded.specNodes?.find((node) => node.id === 'manual-node')?.doc.items).toEqual([
      { id: 'custom', text: 'Custom', kind: 'heading', headingLevel: 2, children: [] },
    ]);
  });

  it('defaults spec selection to the chosen tool root', () => {
    const loaded = loadSpecDocument({
      ...createEmptySpecDocument(),
      tools: [
        { id: 'tool-a', nameJa: 'ツールA', nameEn: 'Tool A' },
        { id: 'tool-b', nameJa: 'ツールB', nameEn: 'Tool B' },
      ],
    });

    expect(getDefaultSelectedSpecNodeId(loaded, 'tool-b')).toBe('tool-node:tool-b');
  });

  it('defines standard display aspect ratios for each viewport', () => {
    expect(viewportDisplayPresets.desktop.frame).toBe('16:9');
    expect(viewportDisplayPresets.desktop.aspectRatio).toBeCloseTo(16 / 9);
    expect(viewportDisplayPresets.tablet.frame).toBe('4:3');
    expect(viewportDisplayPresets.tablet.aspectRatio).toBeCloseTo(4 / 3);
    expect(viewportDisplayPresets.mobile.frame).toBe('9:16');
    expect(viewportDisplayPresets.mobile.aspectRatio).toBeCloseTo(9 / 16);
  });

  it('migrates legacy task rows into independent issues on load', () => {
    const loaded = loadSpecDocument({
      ...createEmptySpecDocument(),
      specNodes: [
        {
          id: 'component-node:ui-spec-editor:screen-1:desktop:component-1',
          kind: 'component',
          titleJa: 'カード',
          titleEn: 'card',
          order: 0,
          metadata: {
            toolId: 'ui-spec-editor',
            screenId: 'screen-1',
            viewportId: 'desktop',
            componentId: 'component-1',
          },
          links: [],
          doc: {
            items: [
              {
                id: 'heading-1',
                text: 'Topic',
                kind: 'heading',
                headingLevel: 1,
                children: [
                  {
                    id: 'task-1',
                    text: 'Legacy issue',
                    kind: 'task',
                    status: 'open',
                    children: [],
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(loaded.issues).toHaveLength(1);
    expect(loaded.issues?.[0]).toMatchObject({
      text: 'Legacy issue',
      sourceNodeId: 'component-node:ui-spec-editor:screen-1:desktop:component-1',
      sourceItemId: 'task-1',
      status: 'open',
      toolId: 'ui-spec-editor',
      screenId: 'screen-1',
      componentId: 'component-1',
    });
    expect(
      loaded.specNodes?.find(
        (node) => node.id === 'component-node:ui-spec-editor:screen-1:desktop:component-1',
      )?.doc.items,
    ).toEqual([
      {
        children: [],
        headingLevel: 1,
        id: 'heading-1',
        kind: 'heading',
        text: 'Topic',
      },
    ]);
  });

  it('backfills existing issue metadata from the source node', () => {
    const loaded = loadSpecDocument({
      ...createEmptySpecDocument(),
      issues: [
        {
          id: 'issue-1',
          text: 'Existing issue',
          status: 'open',
          sourceNodeId: 'component-node:ui-spec-editor:screen-1:desktop:component-1',
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

    expect(loaded.issues?.[0]).toMatchObject({
      id: 'issue-1',
      toolId: 'ui-spec-editor',
      screenId: 'screen-1',
      componentId: 'component-1',
    });
  });
});
