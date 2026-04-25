import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { GridApp } from '../grid/app';
import { resolveRendererRoot } from './resolve-renderer-root';

export const mountRenderer = (): void => {
  const root = createRoot(resolveRendererRoot());
  root.render(createElement(StrictMode, null, createElement(GridApp)));
};
