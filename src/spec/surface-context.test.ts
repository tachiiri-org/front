import { describe, expect, it } from 'vitest';

import type { SpecDocument } from './editor-schema';
import { createEmptySpecDocument } from './editor-document';
import {
  buildSurfaceContext,
  createStarterScreenFromGoal,
  exportGitHubIssueDraft,
  exportSurfaceContextPrompt,
} from './surface-context';

const createDocument = (): SpecDocument => ({
  ...createEmptySpecDocument(),
  screens: [
    {
      id: 'checkout-screen',
      nameJa: '申込画面',
      nameEn: 'Checkout Screen',
      viewports: {
        desktop: {
          id: 'desktop',
          components: [
            {
              id: 'hero-title',
              nameJa: 'メイン見出し',
              nameEn: 'heroTitle',
              type: 'Heading',
              frame: { x: 10, y: 10, w: 60, h: 12 },
              props: { title: 'Start your application', level: '1' },
              editorMetadata: { note: 'Primary conversion message' },
              zIndex: 1,
            },
            {
              id: 'cta-button',
              nameJa: '申込ボタン',
              nameEn: 'ctaButton',
              type: 'Button',
              frame: { x: 10, y: 28, w: 24, h: 8 },
              props: { title: 'Apply now', emphasis: 'primary' },
              editorMetadata: { note: '' },
              zIndex: 2,
            },
          ],
        },
        tablet: { id: 'tablet', components: [] },
        mobile: { id: 'mobile', components: [] },
      },
    },
  ],
});

describe('surface-context', () => {
  it('builds a reusable surface context from the current editor state', () => {
    const context = buildSurfaceContext({
      document: createDocument(),
      goal: 'Make the CTA more prominent on the desktop screen.',
      screenId: 'checkout-screen',
      selectedComponentId: 'cta-button',
      viewportId: 'desktop',
    });

    expect(context.intent.goal).toBe('Make the CTA more prominent on the desktop screen.');
    expect(context.surface.screenId).toBe('checkout-screen');
    expect(context.surface.selectedComponentId).toBe('cta-button');
    expect(context.selection?.component?.type).toBe('Button');
    expect(context.references[0]).toMatchObject({
      componentId: 'hero-title',
      token: '@hero-title',
    });
    expect(context.references[1]).toMatchObject({
      componentId: 'cta-button',
      token: '@cta-button',
    });
  });

  it('exports a codex-friendly prompt from a surface context', () => {
    const context = buildSurfaceContext({
      document: createDocument(),
      goal: 'Refine the above-the-fold messaging.',
      screenId: 'checkout-screen',
      selectedComponentId: 'hero-title',
      viewportId: 'desktop',
    });

    const prompt = exportSurfaceContextPrompt(context);

    expect(prompt).toContain('# Surface Context');
    expect(prompt).toContain('Goal: Refine the above-the-fold messaging.');
    expect(prompt).toContain('Selected Component: @hero-title');
    expect(prompt).toContain('@cta-button');
    expect(prompt).toContain('Primary conversion message');
  });

  it('creates a starter screen from a free-form goal', () => {
    const screen = createStarterScreenFromGoal('Create a signup UI skeleton', 2);

    expect(screen.id).toBe('generated-screen-2');
    expect(screen.viewports.desktop.components.map((component) => component.type)).toEqual([
      'Page',
      'Heading',
      'Text',
      'Input',
      'Button',
    ]);
    expect(screen.viewports.mobile.components).toHaveLength(5);
    expect(screen.viewports.desktop.components[1]?.props).toMatchObject({
      title: 'Create a signup UI skeleton',
    });
  });

  it('exports a GitHub issue draft from the current surface context', () => {
    const context = buildSurfaceContext({
      document: createDocument(),
      goal: 'Improve the conversion flow.',
      screenId: 'checkout-screen',
      selectedComponentId: 'cta-button',
      viewportId: 'desktop',
    });
    const draft = exportGitHubIssueDraft(context);

    expect(draft).toContain('## Context');
    expect(draft).toContain('Screen: `checkout-screen`');
    expect(draft).toContain('Viewport: `desktop`');
    expect(draft).toContain('Selected Component: `cta-button`');
    expect(draft).toContain('## Surface Context');
  });
});
