import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { EditorScreen } from '../editor/app';
import { createWebRuntimeServices } from '../runtime/web/create-runtime-services';
import { resolveRendererMode } from './renderer-mode';
import { resolveRendererRoot } from './resolve-renderer-root';

export const mountRenderer = async (): Promise<void> => {
  const rendererMode = resolveRendererMode(window.location.search);
  const root = createRoot(resolveRendererRoot());
  let runtimeServices = null;
  let bootstrapError: string | null = null;

  try {
    runtimeServices = createWebRuntimeServices();
  } catch (error) {
    bootstrapError = error instanceof Error ? error.message : 'Runtime services are unavailable.';
  }

  root.render(
    createElement(
      StrictMode,
      null,
      createElement(EditorScreen, {
        bootstrapError,
        key: rendererMode,
        runtimeServices,
      }),
    ),
  );
};
