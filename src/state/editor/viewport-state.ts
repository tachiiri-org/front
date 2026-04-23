import { copyViewport } from '../../spec/editor-document';
import type { ScreenSpec, SpecDocument, ViewportId, ViewportSpec } from '../../spec/editor-schema';

import { normalizeViewportComponents } from './layout-constraints';

export const getScreen = (document: SpecDocument, screenId: string): ScreenSpec =>
  document.screens.find((screen) => screen.id === screenId) ?? document.screens[0]!;

export const getViewport = (
  document: SpecDocument,
  screenId: string,
  viewportId: ViewportId,
): ViewportSpec => getScreen(document, screenId).viewports[viewportId];

export const replaceScreen = (
  document: SpecDocument,
  screenId: string,
  updater: (screen: ScreenSpec) => ScreenSpec,
): SpecDocument => ({
  ...document,
  screens: document.screens.map((screen) => (screen.id === screenId ? updater(screen) : screen)),
});

export const replaceViewport = (
  document: SpecDocument,
  screenId: string,
  viewportId: ViewportId,
  updater: (viewport: ViewportSpec) => ViewportSpec,
): SpecDocument =>
  replaceScreen(document, screenId, (screen) => ({
    ...screen,
    viewports: {
      ...screen.viewports,
      [viewportId]: (() => {
        const nextViewport = updater(screen.viewports[viewportId]);

        return {
          ...nextViewport,
          components: normalizeViewportComponents(nextViewport.components),
        };
      })(),
    },
  }));

export const copyViewportState = (
  document: SpecDocument,
  screenId: string,
  sourceViewportId: ViewportId,
  destinationViewportId: ViewportId,
): SpecDocument =>
  replaceScreen(document, screenId, (screen) => ({
    ...screen,
    viewports: {
      ...screen.viewports,
      [destinationViewportId]: copyViewport(
        screen.viewports[sourceViewportId],
        destinationViewportId,
      ),
    },
  }));
