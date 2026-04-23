import { exportPromptDocument } from './editor-document';
import type { ScreenSpec, SpecDocument, ViewportId } from './editor-schema';

import type {
  SurfaceContext,
  SurfaceIntentAction,
  SurfaceReference,
} from '@shared/surface-context';

const normalizeGoal = (goal: string): string => goal.trim() || 'Describe and improve this surface.';

const createReference = (
  component: SurfaceContext['currentViewport']['components'][number],
): SurfaceReference => ({
  componentId: component.id,
  label: `${component.nameJa} / ${component.type}`,
  token: `@${component.id}`,
  type: component.type,
});

const createScreenTitle = (goal: string): { readonly nameEn: string; readonly nameJa: string } => {
  const normalized = normalizeGoal(goal);

  return {
    nameEn: 'Generated Screen',
    nameJa: normalized.length <= 32 ? normalized : `${normalized.slice(0, 29)}...`,
  };
};

const createStarterViewportComponents = (
  goal: string,
  prefix: string,
  viewportId: ViewportId,
): ScreenSpec['viewports'][ViewportId]['components'] => {
  const isFormGoal = /sign[\s-]?up|signup|login|register|apply|contact|form|account/i.test(goal);
  const frames = {
    desktop: {
      button: { x: 12, y: 44, w: 26, h: 8 },
      heading: { x: 12, y: 14, w: 70, h: 12 },
      input: { x: 12, y: 34, w: 42, h: 8 },
      page: { x: 4, y: 4, w: 112, h: 104 },
      text: { x: 12, y: 28, w: 62, h: 10 },
    },
    tablet: {
      button: { x: 12, y: 48, w: 30, h: 8 },
      heading: { x: 12, y: 14, w: 76, h: 14 },
      input: { x: 12, y: 37, w: 56, h: 8 },
      page: { x: 6, y: 6, w: 108, h: 102 },
      text: { x: 12, y: 30, w: 70, h: 12 },
    },
    mobile: {
      button: { x: 10, y: 56, w: 40, h: 9 },
      heading: { x: 10, y: 12, w: 84, h: 16 },
      input: { x: 10, y: 42, w: 62, h: 8 },
      page: { x: 4, y: 4, w: 112, h: 112 },
      text: { x: 10, y: 28, w: 84, h: 13 },
    },
  }[viewportId];

  const components: ScreenSpec['viewports'][ViewportId]['components'] = [
    {
      id: `${prefix}-${viewportId}-page`,
      nameJa: 'ページ',
      nameEn: `${viewportId}Page`,
      type: 'Page',
      frame: frames.page,
      props: {
        title: normalizeGoal(goal),
        surface: 'canvas',
        textAlign: 'left',
        fontSize: viewportId === 'mobile' ? 16 : 18,
        color: '#cccccc',
      },
      editorMetadata: { note: 'Generated scaffold root for this viewport.' },
      zIndex: 0,
    },
    {
      id: `${prefix}-${viewportId}-heading`,
      nameJa: 'メイン見出し',
      nameEn: `${viewportId}Heading`,
      type: 'Heading',
      parentId: `${prefix}-${viewportId}-page`,
      frame: frames.heading,
      props: {
        title: normalizeGoal(goal),
        level: '1',
        textAlign: 'left',
        fontSize: viewportId === 'mobile' ? 20 : 24,
        color: '#ffffff',
      },
      editorMetadata: { note: 'Primary message generated from the current goal.' },
      zIndex: 1,
    },
    {
      id: `${prefix}-${viewportId}-text`,
      nameJa: '説明文',
      nameEn: `${viewportId}Body`,
      type: 'Text',
      parentId: `${prefix}-${viewportId}-page`,
      frame: frames.text,
      props: {
        title: 'Refine this copy and structure it to match the intended user journey.',
        textAlign: 'left',
        fontSize: 16,
        color: '#cccccc',
      },
      editorMetadata: { note: 'Replace this with the exact supporting explanation.' },
      zIndex: 2,
    },
  ];

  if (isFormGoal) {
    components.push({
      id: `${prefix}-${viewportId}-input`,
      nameJa: '主要入力欄',
      nameEn: `${viewportId}PrimaryInput`,
      type: 'Input',
      parentId: `${prefix}-${viewportId}-page`,
      frame: frames.input,
      props: { placeholder: 'Type here' },
      editorMetadata: { note: 'Generated because the goal suggests a form-like flow.' },
      zIndex: 3,
    });
  }

  components.push({
    id: `${prefix}-${viewportId}-button`,
    nameJa: '主要CTA',
    nameEn: `${viewportId}PrimaryAction`,
    type: 'Button',
    parentId: `${prefix}-${viewportId}-page`,
    frame: frames.button,
    props: {
      title: isFormGoal ? 'Continue' : 'Get started',
      emphasis: 'primary',
      textAlign: 'center',
      fontSize: 14,
      color: '#ffffff',
    },
    editorMetadata: { note: 'Primary action generated from the current goal.' },
    zIndex: isFormGoal ? 4 : 3,
  });

  return components;
};

export const createStarterScreenFromGoal = (goal: string, screenNumber: number): ScreenSpec => {
  const names = createScreenTitle(goal);
  const prefix = `generated-screen-${screenNumber}`;

  return {
    id: prefix,
    nameEn: names.nameEn,
    nameJa: names.nameJa,
    viewports: {
      desktop: {
        id: 'desktop',
        components: createStarterViewportComponents(goal, prefix, 'desktop'),
      },
      tablet: {
        id: 'tablet',
        components: createStarterViewportComponents(goal, prefix, 'tablet'),
      },
      mobile: {
        id: 'mobile',
        components: createStarterViewportComponents(goal, prefix, 'mobile'),
      },
    },
  };
};

export const buildSurfaceContext = ({
  document,
  goal,
  requestedAction = 'implement',
  runtime = 'electron',
  screenId,
  selectedComponentId,
  sourceApp = 'ui-spec-editor',
  viewportId,
}: {
  readonly document: SpecDocument;
  readonly goal: string;
  readonly requestedAction?: SurfaceIntentAction;
  readonly runtime?: SurfaceContext['runtime'];
  readonly screenId: string;
  readonly selectedComponentId: string | null;
  readonly sourceApp?: string;
  readonly viewportId: ViewportId;
}): SurfaceContext => {
  const screen = document.screens.find((entry) => entry.id === screenId) ?? document.screens[0]!;
  const viewport = screen.viewports[viewportId];
  const selectedComponent =
    viewport.components.find((component) => component.id === selectedComponentId) ?? null;

  return {
    version: 1,
    sourceApp,
    runtime,
    intent: {
      goal: normalizeGoal(goal),
      requestedAction,
    },
    surface: {
      screenId: screen.id,
      screenNameEn: screen.nameEn,
      screenNameJa: screen.nameJa,
      selectedComponentId: selectedComponent?.id ?? null,
      viewportId,
    },
    currentScreen: screen,
    currentViewport: viewport,
    document,
    references: viewport.components
      .slice()
      .sort((left, right) => left.zIndex - right.zIndex)
      .map(createReference),
    selection: selectedComponent ? { component: selectedComponent } : null,
    summary: exportPromptDocument(document),
  };
};

export const exportSurfaceContextPrompt = (context: SurfaceContext): string => {
  const lines = [
    '# Surface Context',
    '',
    `Goal: ${context.intent.goal}`,
    `Requested Action: ${context.intent.requestedAction}`,
    `Runtime: ${context.runtime}`,
    `Surface: ${context.surface.screenNameEn} / ${context.surface.screenNameJa} / ${context.surface.viewportId}`,
    context.selection
      ? `Selected Component: @${context.selection.component.id} (${context.selection.component.nameJa} / ${context.selection.component.type})`
      : 'Selected Component: none',
    '',
    '## Component References',
    ...context.references.map((reference) => `- ${reference.token} ${reference.label}`),
    '',
    '## Selection Notes',
  ];

  if (context.selection) {
    lines.push(
      `- Note: ${context.selection.component.editorMetadata.note || 'No editor note.'}`,
      `- Frame: (${context.selection.component.frame.x}, ${context.selection.component.frame.y}, ${context.selection.component.frame.w}, ${context.selection.component.frame.h})`,
    );
  } else {
    lines.push('- No component is currently selected.');
  }

  lines.push('', '## Document Summary', context.summary);

  return lines.join('\n').trim();
};

export const exportGitHubIssueDraft = (context: SurfaceContext): string => {
  const selectedComponentId = context.surface.selectedComponentId ?? 'none';
  const titleBase =
    context.selection?.component.nameJa ||
    context.surface.screenNameJa ||
    context.surface.screenNameEn ||
    context.surface.screenId;
  const lines = [
    `# ${titleBase}: ${context.intent.goal}`,
    '',
    '## Context',
    `- Screen: \`${context.surface.screenId}\``,
    `- Viewport: \`${context.surface.viewportId}\``,
    `- Selected Component: \`${selectedComponentId}\``,
    `- Requested Action: \`${context.intent.requestedAction}\``,
    `- Runtime: \`${context.runtime}\``,
    '',
    '## Request',
    context.intent.goal,
    '',
    '## Surface Context',
    '```text',
    exportSurfaceContextPrompt(context),
    '```',
  ];

  return lines.join('\n').trim();
};
