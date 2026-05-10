import { isScreen, isFrameRef, type Screen, type Frame } from './schema/screen/screen';
import type { Component } from './schema/component';
import { renderComponent, fetchFrameComponent, findEditorScreenId, hydrateEditor, store, domMap } from './runtime';
import type { FrameState } from './state';

const root = document.createElement('div');
document.body.appendChild(root);

const getScreenIdFromPathname = (): string | null => {
  const pathname = window.location.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') return null;
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length !== 1) return null;
  try {
    return decodeURIComponent(segments[0]);
  } catch {
    return null;
  }
};

const applyPlacement = (el: HTMLElement, frame: Frame): void => {
  el.style.gridColumn = `${frame.placement.x} / span ${frame.placement.width}`;
  el.style.gridRow = `${frame.placement.y} / span ${frame.placement.height}`;
  el.style.minWidth = '0';
  el.style.minHeight = '0';
};

const showLoadError = (message: string): void => {
  document.body.style.margin = '0';
  document.body.style.padding = '24px';
  document.body.style.fontFamily = 'monospace';
  root.replaceChildren();
  const pre = document.createElement('pre');
  pre.textContent = message;
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.margin = '0';
  root.appendChild(pre);
};

const renderScreen = async (screenId: string): Promise<void> => {
  const response = await fetch(`/api/layouts/${screenId}`);
  if (!response.ok) {
    showLoadError(`Failed to load screen "${screenId}" (${response.status} ${response.statusText}).`);
    return;
  }

  const value = (await response.json()) as unknown;
  if (!isScreen(value)) {
    showLoadError(`Invalid screen payload for "${screenId}".`);
    return;
  }

  store.screen = value;
  store.frameComponents.clear();
  domMap.clear();

  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.overflow = 'hidden';

  root.innerHTML = '';
  document.title = store.screen.head.title;
  for (const { name, content } of (store.screen.head.meta ?? [])) {
    const meta = document.createElement('meta');
    meta.name = name;
    meta.content = content;
    document.head.appendChild(meta);
  }

  Object.assign(root.style, store.screen.shell ?? {});
  const canvas = document.createElement('div');
  canvas.style.display = 'grid';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.boxSizing = 'border-box';
  canvas.style.gridTemplateColumns = `repeat(${store.screen.grid.columns}, minmax(0, 1fr))`;
  if (store.screen.grid.rows) {
    canvas.style.gridTemplateRows = `repeat(${store.screen.grid.rows}, minmax(0, 1fr))`;
  } else {
    canvas.style.gridAutoRows = '1fr';
  }
  canvas.style.alignItems = 'stretch';
  root.appendChild(canvas);

  root.style.transform = '';
  root.style.transformOrigin = '';
  requestAnimationFrame(() => {
    const sw = root.offsetWidth;
    const sh = root.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (sw > 0 && sh > 0 && (sw > vw || sh > vh)) {
      const scale = Math.min(vw / sw, vh / sh);
      root.style.transformOrigin = '0 0';
      root.style.transform = `scale(${scale})`;
    }
  });

  await Promise.all(
    store.screen.frames
      .filter(isFrameRef)
      .map(async (frame) => {
        const component = await fetchFrameComponent(screenId, frame.src);
        if (component) store.frameComponents.set(frame.id, component);
      }),
  );

  for (const frame of store.screen.frames) {
    const state: FrameState = store.frameStates.get(frame.id) ?? {};
    const resolved = isFrameRef(frame) ? (store.frameComponents.get(frame.id) ?? null) : null;
    const el = renderComponent(frame, state, resolved, { screenId });
    applyPlacement(el, frame);
    canvas.appendChild(el);
    domMap.set(frame.id, el);
  }
};

export const rerender = (id: string): void => {
  const frame = store.screen?.frames.find((f) => f.id === id);
  if (!frame) return;
  const oldEl = domMap.get(id);
  if (!oldEl) return;
  const state: FrameState = store.frameStates.get(id) ?? {};
  const resolved = isFrameRef(frame) ? (store.frameComponents.get(id) ?? null) : null;
  const newEl = renderComponent(frame, state, resolved, {
    screenId: currentEditorScreenId ?? undefined,
  });
  applyPlacement(newEl, frame);
  oldEl.replaceWith(newEl);
  domMap.set(id, newEl);
};

let currentEditorScreenId: string | null = null;

const reloadEditor = (): void => {
  if (currentEditorScreenId) void loadEditor(currentEditorScreenId);
};

const loadEditor = async (screenId: string): Promise<void> => {
  currentEditorScreenId = screenId;
  await renderScreen(screenId);
  await hydrateEditor(reloadEditor, screenId, rerender);
};

const loadEditorBootstrap = async (): Promise<void> => {
  const pathnameScreenId = getScreenIdFromPathname();
  const screenId = pathnameScreenId ?? await findEditorScreenId();
  if (!screenId) {
    root.replaceChildren();
    return;
  }
  await loadEditor(screenId);
};

void loadEditorBootstrap();
