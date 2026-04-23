import type { NamedOption, ScreenSpec, SpecDocument } from '../../spec/editor-schema';

let nextIdCounter = 1;

export const createId = (prefix: string): string => `${prefix}-${nextIdCounter++}`;

export const createNamedOption = (prefix: string, label: string): NamedOption => ({
  id: createId(prefix),
  nameJa: `${label}${nextIdCounter - 1}`,
  nameEn: `${prefix}${nextIdCounter - 1}`,
});

export const addConcern = (document: SpecDocument): SpecDocument => ({
  ...document,
  concerns: [...document.concerns, createNamedOption('concern', '関心')],
});

export const removeConcern = (document: SpecDocument, concernId: string): SpecDocument => ({
  ...document,
  concerns: document.concerns.filter((concern) => concern.id !== concernId),
});

export const addTool = (document: SpecDocument): SpecDocument => ({
  ...document,
  tools: [...document.tools, createNamedOption('tool', 'ツール')],
});

export const removeTool = (document: SpecDocument, toolId: string): SpecDocument => ({
  ...document,
  issues: (document.issues ?? []).filter((issue) => issue.toolId !== toolId),
  tools:
    document.tools.length === 1
      ? document.tools
      : document.tools.filter((tool) => tool.id !== toolId),
});

export const updateTool = (
  document: SpecDocument,
  toolId: string,
  updater: (tool: NamedOption) => NamedOption,
): SpecDocument => ({
  ...document,
  tools: document.tools.map((tool) => (tool.id === toolId ? updater(tool) : tool)),
});

export const addScreen = (document: SpecDocument): SpecDocument => ({
  ...document,
  screens: [
    ...document.screens,
    {
      id: createId('screen'),
      nameJa: `画面${nextIdCounter - 1}`,
      nameEn: `Screen ${nextIdCounter - 1}`,
      viewports: {
        desktop: { id: 'desktop', components: [] },
        tablet: { id: 'tablet', components: [] },
        mobile: { id: 'mobile', components: [] },
      },
    },
  ],
});

export const removeScreen = (document: SpecDocument, screenId: string): SpecDocument => ({
  ...document,
  screens:
    document.screens.length === 1
      ? document.screens
      : document.screens.filter((screen) => screen.id !== screenId),
});

export const reorderScreen = (
  document: SpecDocument,
  screenId: string,
  direction: 'up' | 'down',
): SpecDocument => {
  const index = document.screens.findIndex((s) => s.id === screenId);

  if (index < 0) {
    return document;
  }

  const targetIndex = direction === 'up' ? index - 1 : index + 1;

  if (targetIndex < 0 || targetIndex >= document.screens.length) {
    return document;
  }

  const screens = [...document.screens];
  [screens[index], screens[targetIndex]] = [screens[targetIndex], screens[index]];

  return { ...document, screens };
};

export const updateScreen = (
  document: SpecDocument,
  screenId: string,
  updater: (s: ScreenSpec) => ScreenSpec,
): SpecDocument => ({
  ...document,
  screens: document.screens.map((s) => (s.id === screenId ? updater(s) : s)),
});
