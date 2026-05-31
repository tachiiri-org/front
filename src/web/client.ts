import { isScreen, isFrameRef, type Screen, type Frame } from './schema/screen/screen';
import type { Component } from './schema/component';
import { ALL_CSS_PROP_KEYS } from './schema/component/style';
import { renderComponent, fetchFrameComponent, findEditorScreenId, hydrateEditor, store, domMap } from './runtime';
import { clearGraphStore } from './runtime/render/page/word-graph/store';
import type { FrameState } from './state';

const root = document.createElement('div');
document.body.appendChild(root);

const applyViewportLayout = (): void => {
  document.documentElement.style.height = '100%';
  document.documentElement.style.width = '100%';
  document.body.style.height = '100%';
  document.body.style.width = '100%';
  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.overflow = 'hidden';

  root.style.width = '100%';
  root.style.height = '100%';
  root.style.minHeight = '100vh';
  root.style.boxSizing = 'border-box';
};

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
  applyViewportLayout();
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
  clearGraphStore();

  applyViewportLayout();

  root.innerHTML = '';
  document.title = store.screen.head.title;
  for (const { name, content } of (store.screen.head.meta ?? [])) {
    const meta = document.createElement('meta');
    meta.name = name;
    meta.content = content;
    document.head.appendChild(meta);
  }

  for (const propKey of ALL_CSS_PROP_KEYS) {
    const v = (store.screen as Record<string, unknown>)[propKey];
    if (typeof v === 'string') (root.style as unknown as Record<string, string>)[propKey] = v;
  }
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

type AuthStatus = {
  github: { authenticated: boolean; login: string | null };
  google: { authenticated: boolean; email: string | null; name: string | null };
};

const renderAuthPage = async (): Promise<void> => {
  const res = await fetch('/api/auth/status');
  const status = (await res.json()) as AuthStatus;

  root.replaceChildren();
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:monospace;gap:1em;';

  if (status.github.authenticated) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:0.5em;';
    const label = document.createElement('span');
    label.textContent = `GitHub: @${status.github.login ?? 'unknown'}`;
    const btn = document.createElement('button');
    btn.textContent = 'Logout';
    btn.onclick = async () => {
      await fetch('/api/auth/github/logout', { method: 'POST' });
      void renderAuthPage();
    };
    row.append(label, btn);
    wrap.appendChild(row);
  } else {
    const a = document.createElement('a');
    a.href = '/oauth/github/start';
    a.textContent = 'Login with GitHub';
    wrap.appendChild(a);
  }

  if (status.google.authenticated) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:0.5em;';
    const label = document.createElement('span');
    label.textContent = `Google: ${status.google.email ?? status.google.name ?? 'unknown'}`;
    const btn = document.createElement('button');
    btn.textContent = 'Logout';
    btn.onclick = async () => {
      await fetch('/api/auth/google/logout', { method: 'POST' });
      void renderAuthPage();
    };
    row.append(label, btn);
    wrap.appendChild(row);
  } else {
    const a = document.createElement('a');
    a.href = '/oauth/google/start';
    a.textContent = 'Login with Google';
    wrap.appendChild(a);
  }

  root.appendChild(wrap);
};

const loadEditorBootstrap = async (): Promise<void> => {
  const pathnameScreenId = getScreenIdFromPathname();
  const screenId = pathnameScreenId ?? await findEditorScreenId();
  if (!screenId) {
    void renderAuthPage();
    return;
  }
  await loadEditor(screenId);
};

void loadEditorBootstrap();
