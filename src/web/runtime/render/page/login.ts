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

function divider(): HTMLElement {
  const wrap = el('div', {
    display: 'flex', alignItems: 'center', gap: '12px',
    margin: '20px 0', color: C.dim, fontSize: '12px',
  });
  const line = () => el('div', { flex: '1', height: '1px', background: C.border });
  wrap.appendChild(line());
  wrap.appendChild(el('span', {}, 'または'));
  wrap.appendChild(line());
  return wrap;
}

// Wire up interactivity given references to the required DOM elements.
function wire(
  emailInput: HTMLInputElement,
  sendBtn: HTMLButtonElement,
  statusEl: HTMLElement,
  errEl: HTMLElement | null,
  ctxEl: HTMLElement | null,
  groupNameInput: HTMLInputElement | null,
  isOrgCreate: boolean,
  orgParam: string | null,
  errorParam: string | null,
): void {
  // Show/hide static sections based on URL params
  if (errEl) {
    errEl.style.display =
      errorParam === 'invalid_magic_link' ? '' :
      errorParam === 'not_a_member' ? '' : 'none';
    if (errorParam === 'not_a_member') {
      errEl.textContent = 'このメールアドレスはこの組織に登録されていません';
    }
  }
  if (ctxEl) {
    if (isOrgCreate) {
      ctxEl.textContent = '新しい組織を作成します';
      ctxEl.style.display = '';
    } else if (orgParam) {
      ctxEl.textContent = '組織専用ログイン';
      ctxEl.style.display = '';
    } else {
      ctxEl.style.display = 'none';
    }
  }

  // group_name field: show only in org_create mode
  if (groupNameInput) {
    groupNameInput.style.display = isOrgCreate ? '' : 'none';
  }

  const purpose = isOrgCreate ? 'org_create' : 'login';

  const send = async (): Promise<void> => {
    const email = emailInput.value.trim();
    if (!email) {
      statusEl.textContent = 'メールアドレスを入力してください';
      statusEl.style.color = C.error;
      return;
    }
    if (isOrgCreate && groupNameInput) {
      const groupName = groupNameInput.value.trim();
      if (!groupName) {
        statusEl.textContent = '組織名を入力してください';
        statusEl.style.color = C.error;
        return;
      }
    }

    // For org-specific login: validate email membership before sending
    if (orgParam && !isOrgCreate) {
      sendBtn.disabled = true;
      sendBtn.textContent = '確認中...';
      statusEl.textContent = '';
      try {
        const checkRes = await fetch(
          `/api/auth/member-check?group_id=${encodeURIComponent(orgParam)}&email=${encodeURIComponent(email)}`,
        );
        if (checkRes.status === 404) {
          statusEl.textContent = 'このメールアドレスはこの組織に登録されていません';
          statusEl.style.color = C.error;
          sendBtn.disabled = false;
          sendBtn.textContent = 'マジックリンクを送信';
          return;
        }
        if (!checkRes.ok) {
          statusEl.textContent = 'エラーが発生しました。もう一度お試しください。';
          statusEl.style.color = C.error;
          sendBtn.disabled = false;
          sendBtn.textContent = 'マジックリンクを送信';
          return;
        }
      } catch {
        statusEl.textContent = 'ネットワークエラーが発生しました。';
        statusEl.style.color = C.error;
        sendBtn.disabled = false;
        sendBtn.textContent = 'マジックリンクを送信';
        return;
      }
    }

    sendBtn.disabled = true;
    sendBtn.textContent = '送信中...';
    statusEl.textContent = '';
    try {
      const body: Record<string, string> = { email, purpose };
      if (orgParam) body.org_id = orgParam;
      if (isOrgCreate && groupNameInput) {
        const groupName = groupNameInput.value.trim();
        if (groupName) body.group_name = groupName;
      }
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        statusEl.textContent = 'メールを送信しました。リンクをクリックしてログインしてください。';
        statusEl.style.color = C.success;
        emailInput.disabled = true;
        if (groupNameInput) groupNameInput.disabled = true;
        sendBtn.textContent = '送信済み';
      } else {
        statusEl.textContent = 'エラーが発生しました。もう一度お試しください。';
        statusEl.style.color = C.error;
        sendBtn.disabled = false;
        sendBtn.textContent = 'マジックリンクを送信';
      }
    } catch {
      statusEl.textContent = 'ネットワークエラーが発生しました。';
      statusEl.style.color = C.error;
      sendBtn.disabled = false;
      sendBtn.textContent = 'マジックリンクを送信';
    }
  };

  sendBtn.addEventListener('click', () => void send());
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void send(); });
  if (groupNameInput) {
    groupNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void send(); });
  }
}

export const renderLoginPage = (root: HTMLElement): void => {
  const params = new URLSearchParams(window.location.search);
  const nextParam = params.get('next');
  const orgParam = params.get('org');
  const errorParam = params.get('error');
  const isOrgCreate = nextParam === 'org_create';

  if (orgParam) {
    document.cookie = `magic_org_id=${encodeURIComponent(orgParam)}; Path=/; Max-Age=600; SameSite=Lax`;
  }
  if (isOrgCreate) {
    document.cookie = `login_intent=org_create; Path=/; Max-Age=600; SameSite=Lax`;
  }

  document.body.style.cssText =
    `background:${C.bg};margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:monospace;`;

  const inputStyle: Partial<CSSStyleDeclaration> = {
    width: '100%', padding: '10px 12px', background: '#0f172a',
    border: `1px solid ${C.border}`, borderRadius: '6px', color: C.text,
    fontSize: '14px', fontFamily: 'monospace', boxSizing: 'border-box',
    marginBottom: '8px', outline: 'none',
  };

  // Hydrate pre-rendered static HTML if elements are already in the DOM
  const emailInput = document.getElementById('l-email') as HTMLInputElement | null;
  const sendBtn = document.getElementById('l-btn') as HTMLButtonElement | null;
  const statusEl = document.getElementById('l-status') as HTMLElement | null;
  if (emailInput && sendBtn && statusEl) {
    const groupNameInput = document.getElementById('l-group-name') as HTMLInputElement | null;
    wire(
      emailInput, sendBtn, statusEl,
      document.getElementById('l-err'),
      document.getElementById('l-ctx'),
      groupNameInput,
      isOrgCreate, orgParam, errorParam,
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
    color: C.bright, fontSize: '24px', fontWeight: '700', margin: '0 0 24px 0', textAlign: 'center',
  }, 'Tempri'));

  const errEl = el('div', {
    background: '#1f0a0a', border: '1px solid #7f1d1d', borderRadius: '6px',
    color: C.error, fontSize: '13px', padding: '10px 12px', marginBottom: '16px',
    display: 'none',
  }, 'マジックリンクが無効または期限切れです');
  errEl.id = 'l-err';
  card.appendChild(errEl);

  const ctxEl = el('div', { color: C.dim, fontSize: '13px', marginBottom: '16px', textAlign: 'center', display: 'none' });
  ctxEl.id = 'l-ctx';
  card.appendChild(ctxEl);

  const btnBase: Partial<CSSStyleDeclaration> = {
    display: 'block', padding: '10px 16px', borderRadius: '6px',
    border: `1px solid ${C.border}`, background: '#0f172a', color: C.text,
    fontSize: '14px', cursor: 'pointer', width: '100%', fontFamily: 'monospace',
    textDecoration: 'none', boxSizing: 'border-box', textAlign: 'center',
  };
  const oauthSection = el('div', { display: 'flex', flexDirection: 'column', gap: '8px' });
  for (const [label, href] of [
    ['GitHub でログイン', '/oauth/github/start'],
    ['Google でログイン', '/oauth/google/start'],
    ['Microsoft でログイン', '/oauth/microsoft/start'],
  ] as const) {
    const btn = el('a', { ...btnBase }, label);
    btn.href = href;
    oauthSection.appendChild(btn);
  }
  card.appendChild(oauthSection);
  card.appendChild(divider());

  const newGroupNameInput = el('input') as HTMLInputElement;
  newGroupNameInput.id = 'l-group-name';
  Object.assign(newGroupNameInput.style, { ...inputStyle, display: 'none' });
  newGroupNameInput.type = 'text';
  newGroupNameInput.placeholder = '組織名';
  card.appendChild(newGroupNameInput);

  const newEmailInput = el('input') as HTMLInputElement;
  newEmailInput.id = 'l-email';
  Object.assign(newEmailInput.style, inputStyle);
  newEmailInput.type = 'email';
  newEmailInput.placeholder = 'メールアドレス';
  card.appendChild(newEmailInput);

  const newSendBtn = el('button', {
    width: '100%', padding: '10px 16px', background: C.accent, border: 'none',
    borderRadius: '6px', color: '#fff', fontSize: '14px', fontFamily: 'monospace',
    cursor: 'pointer', fontWeight: '600',
  }, 'マジックリンクを送信') as HTMLButtonElement;
  newSendBtn.id = 'l-btn';
  card.appendChild(newSendBtn);

  const newStatusEl = el('div', { marginTop: '12px', fontSize: '13px', textAlign: 'center', minHeight: '20px' });
  newStatusEl.id = 'l-status';
  card.appendChild(newStatusEl);

  root.replaceChildren(card);

  wire(newEmailInput, newSendBtn, newStatusEl, errEl, ctxEl, newGroupNameInput, isOrgCreate, orgParam, errorParam);
};
