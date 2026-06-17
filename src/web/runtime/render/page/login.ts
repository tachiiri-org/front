const C = {
  bg: '#0f172a',
  surface: '#1e293b',
  border: '#334155',
  text: '#cbd5e1',
  bright: '#f1f5f9',
  dim: '#64748b',
  accent: '#3b82f6',
  error: '#f87171',
  success: '#4ade80',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles?: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (text !== undefined) e.textContent = text;
  return e;
}

const inputStyle: Partial<CSSStyleDeclaration> = {
  width: '100%', padding: '10px 12px', background: '#0f172a',
  border: `1px solid ${C.border}`, borderRadius: '6px', color: C.text,
  fontSize: '14px', fontFamily: 'monospace', boxSizing: 'border-box',
  marginBottom: '8px', outline: 'none', display: 'block',
};

function divider(text = 'または'): HTMLElement {
  const wrap = el('div', {
    display: 'flex', alignItems: 'center', gap: '12px',
    margin: '16px 0', color: C.dim, fontSize: '12px',
  });
  const line = () => el('div', { flex: '1', height: '1px', background: C.border });
  wrap.appendChild(line());
  wrap.appendChild(el('span', {}, text));
  wrap.appendChild(line());
  return wrap;
}

const tabActiveStyle: Partial<CSSStyleDeclaration> = {
  color: C.bright, borderBottomColor: C.accent, fontWeight: '600',
};
const tabInactiveStyle: Partial<CSSStyleDeclaration> = {
  color: C.dim, borderBottomColor: 'transparent', fontWeight: '400',
};

type TurnstileAPI = {
  render(el: HTMLElement, opts: { sitekey: string; theme: string }): string;
  getResponse(widgetId: string): string;
  reset(widgetId: string): void;
};

function setupTurnstile(container: HTMLElement, siteKey: string): () => string {
  const w = window as unknown as Record<string, unknown>;
  let widgetId: string | undefined;
  const render = () => {
    const api = w.turnstile as TurnstileAPI | undefined;
    if (api && !widgetId) widgetId = api.render(container, { sitekey: siteKey, theme: 'dark' });
  };
  if ((w.turnstile as TurnstileAPI | undefined)) {
    render();
  } else {
    w.__onTurnstileLoad = () => { render(); };
  }
  return () => {
    const api = w.turnstile as TurnstileAPI | undefined;
    return (widgetId && api) ? api.getResponse(widgetId) : '';
  };
}

function wire(
  tabLoginEl: HTMLButtonElement,
  tabNewGroupEl: HTMLButtonElement,
  panelLoginEl: HTMLElement,
  panelNewGroupEl: HTMLElement,
  errEl: HTMLElement | null,
  statusEl: HTMLElement,
  isGroupCreate: boolean,
  groupParam: string | null,
  errorParam: string | null,
): void {
  // Error message
  if (errEl) {
    errEl.style.display =
      errorParam === 'invalid_magic_link' ? '' :
      errorParam === 'not_a_member' ? '' : 'none';
    if (errorParam === 'not_a_member') {
      errEl.textContent = 'このメールアドレスはこのグループに登録されていません';
    }
  }

  const setTab = (tab: 'login' | 'new-group'): void => {
    Object.assign(tabLoginEl.style, tab === 'login' ? tabActiveStyle : tabInactiveStyle);
    Object.assign(tabNewGroupEl.style, tab === 'new-group' ? tabActiveStyle : tabInactiveStyle);
    panelLoginEl.style.display = tab === 'login' ? 'block' : 'none';
    panelNewGroupEl.style.display = tab === 'new-group' ? 'block' : 'none';
  };

  setTab(isGroupCreate ? 'new-group' : 'login');
  tabLoginEl.addEventListener('click', () => { setTab('login'); statusEl.textContent = ''; });
  tabNewGroupEl.addEventListener('click', () => { setTab('new-group'); statusEl.textContent = ''; });

  const siteKey = (window as unknown as Record<string, unknown>).__TURNSTILE_SITE_KEY__ as string | undefined;

  // Login panel: magic link section (only for group-specific URL)
  const mlSection = panelLoginEl.querySelector<HTMLElement>('#l-ml-section');
  if (mlSection) {
    mlSection.style.display = groupParam ? 'block' : 'none';
  }

  // Login panel: group-specific magic link send
  const emailLoginInput = panelLoginEl.querySelector<HTMLInputElement>('#l-email-login');
  const btnLogin = panelLoginEl.querySelector<HTMLButtonElement>('#l-btn-login');

  let getLoginToken: (() => string) | undefined;
  if (siteKey && btnLogin) {
    const tsContainer = document.createElement('div');
    tsContainer.style.cssText = 'margin-bottom:8px;';
    btnLogin.parentElement?.insertBefore(tsContainer, btnLogin);
    getLoginToken = setupTurnstile(tsContainer, siteKey);
  }

  if (groupParam && emailLoginInput && btnLogin) {
    const sendGroupLogin = async (): Promise<void> => {
      const email = emailLoginInput.value.trim();
      if (!email) {
        statusEl.textContent = 'メールアドレスを入力してください';
        statusEl.style.color = C.error;
        return;
      }
      if (siteKey) {
        const token = getLoginToken?.() ?? '';
        if (!token) {
          statusEl.textContent = 'ボット確認が完了していません。しばらくお待ちください。';
          statusEl.style.color = C.error;
          return;
        }
      }
      btnLogin.disabled = true;
      btnLogin.textContent = '確認中...';
      statusEl.textContent = '';
      try {
        const checkRes = await fetch(
          `/api/auth/member-check?group_id=${encodeURIComponent(groupParam)}&email=${encodeURIComponent(email)}`,
        );
        if (checkRes.status === 404) {
          statusEl.textContent = 'このメールアドレスはこのグループに登録されていません';
          statusEl.style.color = C.error;
          btnLogin.disabled = false;
          btnLogin.textContent = 'マジックリンクを送信';
          return;
        }
        if (!checkRes.ok) {
          statusEl.textContent = 'エラーが発生しました。もう一度お試しください。';
          statusEl.style.color = C.error;
          btnLogin.disabled = false;
          btnLogin.textContent = 'マジックリンクを送信';
          return;
        }
      } catch {
        statusEl.textContent = 'ネットワークエラーが発生しました。';
        statusEl.style.color = C.error;
        btnLogin.disabled = false;
        btnLogin.textContent = 'マジックリンクを送信';
        return;
      }
      btnLogin.textContent = '送信中...';
      try {
        const turnstileToken = getLoginToken?.() || undefined;
        const res = await fetch('/api/auth/magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, purpose: 'login', group_id: groupParam, turnstile_token: turnstileToken }),
        });
        if (res.ok) {
          statusEl.textContent = 'メールを送信しました。リンクをクリックしてログインしてください。';
          statusEl.style.color = C.success;
          emailLoginInput.disabled = true;
          btnLogin.textContent = '送信済み';
        } else {
          statusEl.textContent = 'エラーが発生しました。もう一度お試しください。';
          statusEl.style.color = C.error;
          btnLogin.disabled = false;
          btnLogin.textContent = 'マジックリンクを送信';
        }
      } catch {
        statusEl.textContent = 'ネットワークエラーが発生しました。';
        statusEl.style.color = C.error;
        btnLogin.disabled = false;
        btnLogin.textContent = 'マジックリンクを送信';
      }
    };
    btnLogin.addEventListener('click', () => void sendGroupLogin());
    emailLoginInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void sendGroupLogin(); });
  }

  // New group panel: group_create magic link send
  const groupNameInput = panelNewGroupEl.querySelector<HTMLInputElement>('#l-group-name');
  const emailNewInput = panelNewGroupEl.querySelector<HTMLInputElement>('#l-email');
  const btnNew = panelNewGroupEl.querySelector<HTMLButtonElement>('#l-btn');

  let getNewToken: (() => string) | undefined;
  if (siteKey && btnNew) {
    const tsContainer = document.createElement('div');
    tsContainer.style.cssText = 'margin-bottom:8px;';
    btnNew.parentElement?.insertBefore(tsContainer, btnNew);
    getNewToken = setupTurnstile(tsContainer, siteKey);
  }

  if (groupNameInput && emailNewInput && btnNew) {
    const sendNewGroup = async (): Promise<void> => {
      const groupName = groupNameInput.value.trim();
      const email = emailNewInput.value.trim();
      if (!groupName) {
        statusEl.textContent = 'グループ名を入力してください';
        statusEl.style.color = C.error;
        return;
      }
      if (!email) {
        statusEl.textContent = 'メールアドレスを入力してください';
        statusEl.style.color = C.error;
        return;
      }
      if (siteKey) {
        const token = getNewToken?.() ?? '';
        if (!token) {
          statusEl.textContent = 'ボット確認が完了していません。しばらくお待ちください。';
          statusEl.style.color = C.error;
          return;
        }
      }
      btnNew.disabled = true;
      btnNew.textContent = '送信中...';
      statusEl.textContent = '';
      try {
        const turnstileToken = getNewToken?.() || undefined;
        const res = await fetch('/api/auth/magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, purpose: 'group_create', group_name: groupName, turnstile_token: turnstileToken }),
        });
        if (res.ok) {
          statusEl.textContent = 'メールを送信しました。リンクをクリックしてグループを作成してください。';
          statusEl.style.color = C.success;
          groupNameInput.disabled = true;
          emailNewInput.disabled = true;
          btnNew.textContent = '送信済み';
        } else {
          statusEl.textContent = 'エラーが発生しました。もう一度お試しください。';
          statusEl.style.color = C.error;
          btnNew.disabled = false;
          btnNew.textContent = 'マジックリンクを送信';
        }
      } catch {
        statusEl.textContent = 'ネットワークエラーが発生しました。';
        statusEl.style.color = C.error;
        btnNew.disabled = false;
        btnNew.textContent = 'マジックリンクを送信';
      }
    };
    btnNew.addEventListener('click', () => void sendNewGroup());
    groupNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void sendNewGroup(); });
    emailNewInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void sendNewGroup(); });
  }
}

export const renderLoginPage = (root: HTMLElement): void => {
  const params = new URLSearchParams(window.location.search);
  const nextParam = params.get('next');
  const groupParam = params.get('group');
  const errorParam = params.get('error');
  const isGroupCreate = nextParam === 'group_create';

  if (groupParam) {
    document.cookie = `magic_group_id=${encodeURIComponent(groupParam)}; Path=/; Max-Age=600; SameSite=Lax`;
  }
  if (isGroupCreate) {
    document.cookie = `login_intent=group_create; Path=/; Max-Age=600; SameSite=Lax`;
  }

  document.body.style.cssText =
    `background:${C.bg};margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:monospace;`;

  // Hydrate pre-rendered static HTML if tab elements are already in the DOM
  const tabLoginEl = document.getElementById('l-tab-login') as HTMLButtonElement | null;
  const tabNewGroupEl = document.getElementById('l-tab-new-group') as HTMLButtonElement | null;
  const panelLoginEl = document.getElementById('l-panel-login') as HTMLElement | null;
  const panelNewGroupEl = document.getElementById('l-panel-new-group') as HTMLElement | null;
  const statusEl = document.getElementById('l-status') as HTMLElement | null;
  if (tabLoginEl && tabNewGroupEl && panelLoginEl && panelNewGroupEl && statusEl) {
    wire(
      tabLoginEl, tabNewGroupEl, panelLoginEl, panelNewGroupEl,
      document.getElementById('l-err'),
      statusEl,
      isGroupCreate, groupParam, errorParam,
    );
    return;
  }

  // Fallback: render from scratch (dev / no pre-built HTML)
  Object.assign(root.style, {
    width: '100%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: '16px', boxSizing: 'border-box',
  });

  const card = el('div', {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px',
    padding: '32px', width: '100%', maxWidth: '360px', boxSizing: 'border-box',
  });

  card.appendChild(el('h1', {
    color: C.bright, fontSize: '24px', fontWeight: '700', margin: '0 0 20px 0', textAlign: 'center',
  }, 'Tempri'));

  const errEl = el('div', {
    background: '#1f0a0a', border: '1px solid #7f1d1d', borderRadius: '6px',
    color: C.error, fontSize: '13px', padding: '10px 12px', marginBottom: '16px',
    display: 'none',
  }, 'マジックリンクが無効または期限切れです');
  errEl.id = 'l-err';
  card.appendChild(errEl);

  // Tab bar
  const tabBar = el('div', {
    display: 'flex', borderBottom: `1px solid ${C.border}`, marginBottom: '20px',
  });
  const tabStyle: Partial<CSSStyleDeclaration> = {
    background: 'none', border: 'none', borderBottom: '2px solid transparent',
    cursor: 'pointer', fontFamily: 'monospace', fontSize: '13px',
    padding: '8px 16px', marginBottom: '-1px',
  };
  const newTabLogin = el('button', { ...tabStyle }, 'ログイン') as HTMLButtonElement;
  newTabLogin.id = 'l-tab-login';
  const newTabNewGroup = el('button', { ...tabStyle }, '新規グループ作成') as HTMLButtonElement;
  newTabNewGroup.id = 'l-tab-new-group';
  tabBar.appendChild(newTabLogin);
  tabBar.appendChild(newTabNewGroup);
  card.appendChild(tabBar);

  // Login panel
  const newPanelLogin = el('div');
  newPanelLogin.id = 'l-panel-login';
  const oauthSection = el('div', { display: 'flex', flexDirection: 'column', gap: '8px' });
  const btnBase: Partial<CSSStyleDeclaration> = {
    display: 'block', padding: '10px 16px', borderRadius: '6px',
    border: `1px solid ${C.border}`, background: '#0f172a', color: C.text,
    fontSize: '14px', cursor: 'pointer', width: '100%', fontFamily: 'monospace',
    textDecoration: 'none', boxSizing: 'border-box', textAlign: 'center',
  };
  for (const [label, href] of [
    ['GitHub でログイン', '/oauth/github/start'],
    ['Google でログイン', '/oauth/google/start'],
    ['Microsoft でログイン', '/oauth/microsoft/start'],
  ] as const) {
    const btn = el('a', { ...btnBase }, label);
    btn.href = href;
    oauthSection.appendChild(btn);
  }
  newPanelLogin.appendChild(oauthSection);
  // Group-specific magic link section
  const mlSection = el('div', { display: 'none' });
  mlSection.id = 'l-ml-section';
  mlSection.appendChild(divider());
  const emailLoginInput = el('input') as HTMLInputElement;
  emailLoginInput.id = 'l-email-login';
  Object.assign(emailLoginInput.style, inputStyle);
  emailLoginInput.type = 'email';
  emailLoginInput.placeholder = 'メールアドレス';
  mlSection.appendChild(emailLoginInput);
  const btnLoginSend = el('button', {
    width: '100%', padding: '10px 16px', background: C.accent, border: 'none',
    borderRadius: '6px', color: '#fff', fontSize: '14px', fontFamily: 'monospace',
    cursor: 'pointer', fontWeight: '600',
  }, 'マジックリンクを送信') as HTMLButtonElement;
  btnLoginSend.id = 'l-btn-login';
  mlSection.appendChild(btnLoginSend);
  newPanelLogin.appendChild(mlSection);
  card.appendChild(newPanelLogin);

  // New group panel
  const newPanelNewGroup = el('div', { display: 'none' });
  newPanelNewGroup.id = 'l-panel-new-group';
  const groupNameInput = el('input') as HTMLInputElement;
  groupNameInput.id = 'l-group-name';
  Object.assign(groupNameInput.style, inputStyle);
  groupNameInput.type = 'text';
  groupNameInput.placeholder = 'グループ名';
  newPanelNewGroup.appendChild(groupNameInput);
  const emailNewInput = el('input') as HTMLInputElement;
  emailNewInput.id = 'l-email';
  Object.assign(emailNewInput.style, inputStyle);
  emailNewInput.type = 'email';
  emailNewInput.placeholder = 'メールアドレス';
  newPanelNewGroup.appendChild(emailNewInput);
  const btnNewSend = el('button', {
    width: '100%', padding: '10px 16px', background: C.accent, border: 'none',
    borderRadius: '6px', color: '#fff', fontSize: '14px', fontFamily: 'monospace',
    cursor: 'pointer', fontWeight: '600',
  }, 'マジックリンクを送信') as HTMLButtonElement;
  btnNewSend.id = 'l-btn';
  newPanelNewGroup.appendChild(btnNewSend);
  card.appendChild(newPanelNewGroup);

  const newStatusEl = el('div', { marginTop: '12px', fontSize: '13px', textAlign: 'center', minHeight: '20px' });
  newStatusEl.id = 'l-status';
  card.appendChild(newStatusEl);

  root.replaceChildren(card);

  wire(newTabLogin, newTabNewGroup, newPanelLogin, newPanelNewGroup, errEl, newStatusEl, isGroupCreate, groupParam, errorParam);
};
