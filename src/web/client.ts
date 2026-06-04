import { isScreen, isFrameRef, type Screen, type Frame } from './schema/screen/screen';
import type { Component } from './schema/component';
import { ALL_CSS_PROP_KEYS } from './schema/component/style';
import { renderComponent, fetchFrameComponent, findEditorScreenId, hydrateEditor, store, domMap } from './runtime';
import { clearGraphStore } from './runtime/render/page/word-graph/store';
import type { FrameState } from './state';

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

  try {
    const authRes = await fetch('/api/auth/status');
    if (authRes.ok) {
      const authStatus = (await authRes.json()) as AuthStatus;
      if (authStatus.github.authenticated || authStatus.google.authenticated) {
        const userEl = document.createElement('span');
        userEl.textContent = authStatus.github.login
          ? `@${authStatus.github.login}`
          : (authStatus.google.email ?? '');
        Object.assign(userEl.style, { color: '#9ca3af', fontSize: '12px' });
        nav.appendChild(userEl);

        const logoutLink = document.createElement('a');
        logoutLink.textContent = 'Logout';
        logoutLink.href = authStatus.github.authenticated
          ? '/oauth/github/logout'
          : '/oauth/google/logout';
        Object.assign(logoutLink.style, { color: '#6b7280', fontSize: '12px', textDecoration: 'none' });
        nav.appendChild(logoutLink);
      } else {
        const loginLink = document.createElement('a');
        loginLink.textContent = 'Login';
        loginLink.href = '/identify-viewer';
        Object.assign(loginLink.style, { color: '#6b7280', fontSize: '12px', textDecoration: 'none' });
        nav.appendChild(loginLink);
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

const reloadEditor = (): void => {
  if (currentEditorScreenId) void loadEditor(currentEditorScreenId);
};

const loadEditor = async (screenId: string): Promise<void> => {
  currentEditorScreenId = screenId;
  await renderScreen(screenId);
  await hydrateEditor(reloadEditor, screenId, rerender);
  await bindOrgSelectScreen();
};

type AuthStatus = {
  github: { authenticated: boolean; login: string | null };
  google: { authenticated: boolean; email: string | null; name: string | null };
};

type IdentityStatus = {
  user_id: string | null;
  organizations: { id: string; name: string }[];
};

const renderAuthPage = async (): Promise<void> => {
  nav.style.display = 'none';
  document.body.style.display = '';

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


const bindOrgSelectScreen = async (): Promise<void> => {
  // Populate org-picker select from identity-status
  const pickerEl = document.querySelector('[data-frame-id="org-picker"]');
  const selectBtnEl = document.querySelector('[data-frame-id="org-select-btn"]');
  const nameInputEl = document.querySelector('[data-frame-id="org-name"]');
  const createBtnEl = document.querySelector('[data-frame-id="org-create-btn"]');

  if (pickerEl instanceof HTMLSelectElement && selectBtnEl instanceof HTMLAnchorElement) {
    const res = await fetch('/api/auth/identity-status');
    const status = (await res.json()) as IdentityStatus;

    pickerEl.replaceChildren();
    if (!status.user_id) {
      window.location.href = '/';
      return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = status.organizations.length > 0 ? '組織を選択...' : '(組織がありません)';
    pickerEl.appendChild(placeholder);

    for (const org of status.organizations) {
      const opt = document.createElement('option');
      opt.value = org.id;
      opt.textContent = org.name;
      pickerEl.appendChild(opt);
    }

    const updateSelectBtn = (): void => {
      const orgId = pickerEl.value;
      if (orgId) {
        selectBtnEl.href = `/api/auth/select-org?org_id=${encodeURIComponent(orgId)}`;
        selectBtnEl.style.opacity = '1';
        selectBtnEl.style.pointerEvents = '';
      } else {
        selectBtnEl.href = '';
        selectBtnEl.style.opacity = '0.4';
        selectBtnEl.style.pointerEvents = 'none';
      }
    };

    updateSelectBtn();
    pickerEl.addEventListener('change', updateSelectBtn);
  }

  if (nameInputEl instanceof HTMLInputElement && createBtnEl instanceof HTMLButtonElement) {
    nameInputEl.placeholder = '組織名を入力';
    createBtnEl.onclick = async (e) => {
      e.preventDefault();
      const name = nameInputEl.value.trim();
      if (!name) return;
      createBtnEl.disabled = true;
      const r = await fetch('/api/auth/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (r.ok) {
        const org = (await r.json()) as { id: string; name: string };
        window.location.href = `/api/auth/select-org?org_id=${encodeURIComponent(org.id)}`;
      } else {
        createBtnEl.disabled = false;
      }
    };
  }
};

const getCookie = (name: string): string | null => {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

const loadEditorBootstrap = async (): Promise<void> => {
  const pathnameScreenId = getScreenIdFromPathname();
  const screenId = pathnameScreenId ?? await findEditorScreenId();
  if (!screenId) {
    void renderAuthPage();
    return;
  }

  if (!getCookie('identity_org_id')) {
    const res = await fetch('/api/auth/identity-status').catch(() => null);
    const status = res?.ok ? (await res.json() as { user_id: string | null }) : null;
    if (status?.user_id) {
      window.location.href = '/org-select';
      return;
    }
  }

  await loadEditor(screenId);
};

window.addEventListener('popstate', () => {
  void loadEditorBootstrap();
});

void loadEditorBootstrap();
