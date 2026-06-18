import { isScreen, isFrameRef, type Screen, type Frame } from './schema/screen/screen';
import type { Component } from './schema/component';
import { ALL_CSS_PROP_KEYS } from './schema/component/style';
import { renderComponent, fetchFrameComponent, findEditorScreenId, hydrateEditor, store, domMap } from './runtime';
import type { FrameState } from './state';
import { renderLoginPage } from './runtime/render/page/login';
import { renderLoginGroupPage } from './runtime/render/page/login-group';
import { renderGroupSelectPage } from './runtime/render/page/group-select';
import { renderSettingsPage } from './runtime/render/page/settings';
import { renderAdminPage } from './runtime/render/page/admin';

const HEADER_HEIGHT = 36;

const nav = document.createElement('nav');
const root = document.createElement('div');
document.body.appendChild(nav);
document.body.appendChild(root);

const applyViewportLayout = (): void => {
  document.documentElement.style.height = '100%';
  document.documentElement.style.width = '100%';
  document.body.style.height = '100%';
  document.body.style.width = '100%';
  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.display = 'flex';
  document.body.style.flexDirection = 'column';

  nav.style.display = 'flex';
  nav.style.flexShrink = '0';
  nav.style.height = `${HEADER_HEIGHT}px`;

  root.style.width = '100%';
  root.style.flex = '1';
  root.style.minHeight = '0';
  root.style.boxSizing = 'border-box';
};

const renderNav = async (screenId: string): Promise<void> => {
  const gen = ++navRenderGen;
  nav.replaceChildren();
  Object.assign(nav.style, {
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    gap: '8px',
    background: '#111827',
    color: '#d1d5db',
    fontFamily: 'monospace',
    fontSize: '13px',
    height: `${HEADER_HEIGHT}px`,
    flexShrink: '0',
    boxSizing: 'border-box',
    borderBottom: '1px solid #374151',
  });

  const titleEl = document.createElement('span');
  titleEl.textContent = screenId;
  Object.assign(titleEl.style, { fontWeight: '600', color: '#f9fafb' });
  nav.appendChild(titleEl);

  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  nav.appendChild(spacer);

  const select = document.createElement('select');
  select.style.cssText =
    'background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:2px 8px;font-size:12px;font-family:monospace;border-radius:4px;cursor:pointer;height:24px;';

  try {
    const res = await fetch('/api/layouts/json-files');
    if (gen !== navRenderGen) return;
    if (res.ok) {
      const data = (await res.json()) as { items: { value: string; label: string }[] };
      for (const item of data.items) {
        const opt = document.createElement('option');
        opt.value = item.value;
        opt.textContent = item.label;
        if (item.value === screenId) opt.selected = true;
        select.appendChild(opt);
      }
    }
  } catch { /* ignore */ }

  select.addEventListener('change', () => {
    const next = select.value;
    if (next && next !== screenId) {
      history.pushState(null, '', `/${encodeURIComponent(next)}`);
      void loadEditor(next);
    }
  });

  nav.appendChild(select);

  const envSelect = document.createElement('select');
  envSelect.style.cssText =
    'background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:2px 8px;font-size:12px;font-family:monospace;border-radius:4px;cursor:pointer;height:24px;';
  const ENVS = [
    { label: 'production', host: 'front-production.tachiiri.workers.dev' },
    { label: 'stage', host: 'front-stage.tachiiri.workers.dev' },
    { label: 'development', host: 'front-dev.tachiiri.workers.dev' },
  ];
  const currentHost = window.location.hostname;
  for (const env of ENVS) {
    const opt = document.createElement('option');
    opt.value = env.host;
    opt.textContent = env.label;
    if (env.host === currentHost) opt.selected = true;
    envSelect.appendChild(opt);
  }
  envSelect.addEventListener('change', () => {
    const host = envSelect.value;
    if (host && host !== currentHost) {
      window.location.href = `https://${host}${window.location.pathname}`;
    }
  });
  nav.appendChild(envSelect);

  const [authResult, identityResult] = await Promise.allSettled([
    fetch('/api/auth/status'),
    fetch('/api/auth/identity-status'),
  ]);
  if (gen !== navRenderGen) return;

  let hasIdentitySession = false;

  try {
    if (identityResult.status === 'fulfilled' && identityResult.value.ok) {
      const identity = (await identityResult.value.json()) as IdentityStatus;
      if (identity.user_id) {
        hasIdentitySession = true;
        const rawOrgId = document.cookie.match(/(?:^|; )identity_group_id=([^;]*)/)?.[1];
        const currentOrgId = rawOrgId ? decodeURIComponent(rawOrgId) : null;
        const orgSelect = document.createElement('select');
        orgSelect.style.cssText =
          'background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:2px 8px;font-size:12px;font-family:monospace;border-radius:4px;cursor:pointer;height:24px;';
        if (!currentOrgId || identity.organizations.length === 0) {
          const placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = identity.organizations.length === 0 ? '(組織なし)' : '組織を選択...';
          orgSelect.appendChild(placeholder);
        }
        for (const org of identity.organizations) {
          const opt = document.createElement('option');
          opt.value = org.id;
          opt.textContent = org.name;
          if (org.id === currentOrgId) opt.selected = true;
          orgSelect.appendChild(opt);
        }
        orgSelect.addEventListener('change', async () => {
          const orgId = orgSelect.value;
          if (!orgId) return;
          await fetch(`/api/auth/select-org?group_id=${encodeURIComponent(orgId)}`, { redirect: 'manual' });
          window.location.reload();
        });
        nav.appendChild(orgSelect);
      }
    }
  } catch { /* ignore */ }

  try {
    if (authResult.status === 'fulfilled' && authResult.value.ok) {
      const authStatus = (await authResult.value.json()) as AuthStatus;
      if (authStatus.github.authenticated || authStatus.google.authenticated || authStatus.microsoft?.authenticated) {
        const userEl = document.createElement('span');
        userEl.textContent = authStatus.github.login
          ? `@${authStatus.github.login}`
          : (authStatus.google.email ?? authStatus.microsoft?.email ?? '');
        Object.assign(userEl.style, { color: '#9ca3af', fontSize: '12px' });
        nav.appendChild(userEl);

        const settingsLink = document.createElement('a');
        settingsLink.textContent = '設定';
        settingsLink.href = '/settings';
        Object.assign(settingsLink.style, { color: '#6b7280', fontSize: '12px', textDecoration: 'none' });
        nav.appendChild(settingsLink);

        const logoutLink = document.createElement('a');
        logoutLink.textContent = 'Logout';
        logoutLink.href = authStatus.github.authenticated
          ? '/oauth/github/logout'
          : authStatus.microsoft?.authenticated
          ? '/oauth/microsoft/logout'
          : '/oauth/google/logout';
        Object.assign(logoutLink.style, { color: '#6b7280', fontSize: '12px', textDecoration: 'none' });
        nav.appendChild(logoutLink);
      } else {
        const loginSelect = document.createElement('select');
        loginSelect.style.cssText =
          'background:#1f2937;color:#d1d5db;border:1px solid #374151;padding:2px 8px;font-size:12px;font-family:monospace;border-radius:4px;cursor:pointer;height:24px;';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Login...';
        placeholder.disabled = true;
        placeholder.selected = true;
        loginSelect.appendChild(placeholder);
        [['GitHub', '/oauth/github/start'], ['Google', '/oauth/google/start'], ['Microsoft', '/oauth/microsoft/start']].forEach(([label, href]) => {
          const opt = document.createElement('option');
          opt.value = href;
          opt.textContent = label;
          loginSelect.appendChild(opt);
        });
        loginSelect.addEventListener('change', () => {
          if (loginSelect.value) window.location.href = loginSelect.value;
        });
        nav.appendChild(loginSelect);
      }
    }
  } catch { /* ignore */ }
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

const readInlineScreenData = (): unknown | null => {
  try {
    const el = document.getElementById('__screen_data__');
    if (!el || !el.textContent) return null;
    return JSON.parse(el.textContent) as unknown;
  } catch {
    return null;
  }
};

const renderScreen = async (screenId: string): Promise<void> => {
  const inlineData = readInlineScreenData();
  let value: unknown;
  if (inlineData !== null) {
    value = inlineData;
  } else {
    const response = await fetch(`/api/layouts/${screenId}`);
    if (!response.ok) {
      showLoadError(`Failed to load screen "${screenId}" (${response.status} ${response.statusText}).`);
      return;
    }
    value = (await response.json()) as unknown;
  }
  if (!isScreen(value)) {
    showLoadError(`Invalid screen payload for "${screenId}".`);
    return;
  }

  store.screen = value;
  store.frameComponents.clear();
  domMap.clear();
  applyViewportLayout();
  void renderNav(screenId);

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
let navRenderGen = 0;

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
  microsoft: { authenticated: boolean; email: string | null; name: string | null };
};

type IdentityStatus = {
  user_id: string | null;
  organizations: { id: string; name: string }[];
};


const getCookie = (name: string): string | null => {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

const loadEditorBootstrap = async (): Promise<void> => {
  const pathnameScreenId = getScreenIdFromPathname();
  const screenId = pathnameScreenId ?? await findEditorScreenId();

  // Group-specific login page: /login/<uuid>
  if (/^\/login\/[0-9a-f-]{36}$/i.test(window.location.pathname)) {
    document.body.style.overflow = 'auto';
    void renderLoginGroupPage(root);
    return;
  }

  // Auth pages: render inline without the editor chrome
  if (screenId === 'login') {
    document.body.style.overflow = 'auto';
    renderLoginPage(root);
    return;
  }
  if (screenId === 'group-select') {
    document.body.style.overflow = 'auto';
    await renderGroupSelectPage(root);
    return;
  }
  if (screenId === 'settings') {
    document.body.style.overflow = 'auto';
    await renderSettingsPage(root);
    return;
  }
  if (window.location.pathname === '/settings/admin') {
    document.body.style.overflow = 'auto';
    await renderAdminPage(root);
    return;
  }

  if (!screenId) {
    applyViewportLayout();
    void renderNav('');
    return;
  }

  if (!getCookie('identity_group_id')) {
    const res = await fetch('/api/auth/identity-status').catch(() => null);
    const status = res?.ok ? (await res.json() as { user_id: string | null }) : null;
    if (status?.user_id) {
      const autoRes = await fetch('/api/auth/auto-select-org').catch(() => null);
      if (autoRes?.ok) {
        window.location.reload();
        return;
      }
      window.location.href = '/group-select';
      return;
    } else {
      window.location.href = '/login';
      return;
    }
  }

  await loadEditor(screenId);
};

window.addEventListener('popstate', () => {
  void loadEditorBootstrap();
});

void loadEditorBootstrap();
