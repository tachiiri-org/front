const C = {
  bg: '#0f172a',
  surface: '#1e293b',
  border: '#164e63',      // teal border — visually distinct from general login
  text: '#cbd5e1',
  bright: '#f1f5f9',
  dim: '#64748b',
  accent: '#0891b2',      // teal accent
  accentHover: '#0e7490',
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

function divider(): HTMLElement {
  const wrap = el('div', {
    display: 'flex', alignItems: 'center', gap: '12px',
    margin: '16px 0', color: C.dim, fontSize: '12px',
  });
  const line = () => el('div', { flex: '1', height: '1px', background: C.border });
  wrap.appendChild(line());
  wrap.appendChild(el('span', {}, 'または'));
  wrap.appendChild(line());
  return wrap;
}

function readGroupData(): { id: string; name: string | null } {
  try {
    const el = document.getElementById('__group_data__');
    if (!el?.textContent) return { id: '', name: null };
    return JSON.parse(el.textContent) as { id: string; name: string | null };
  } catch {
    return { id: '', name: null };
  }
}

export const renderLoginGroupPage = async (root: HTMLElement): Promise<void> => {
  const data = readGroupData();
  const groupId = data.id || window.location.pathname.split('/').pop() || '';
  const groupName = data.name;

  const params = new URLSearchParams(window.location.search);
  const errorParam = params.get('error');

  if (groupId) {
    document.cookie = `magic_group_id=${encodeURIComponent(groupId)}; Path=/; Max-Age=600; SameSite=Lax`;
  }

  document.body.style.cssText =
    `background:${C.bg};margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:monospace;`;
  Object.assign(root.style, {
    width: '100%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: '16px', boxSizing: 'border-box',
  });

  const card = el('div', {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderTop: `3px solid ${C.accent}`,
    borderRadius: '12px',
    padding: '32px',
    width: '100%',
    maxWidth: '360px',
    boxSizing: 'border-box',
  });

  // Header: group name
  const headerWrap = el('div', { marginBottom: '24px', textAlign: 'center' });
  headerWrap.appendChild(el('h1', {
    color: C.bright, fontSize: '22px', fontWeight: '700', margin: '0',
  }, groupName ?? 'Tempri'));
  if (groupName) {
    headerWrap.appendChild(el('div', {
      color: C.dim, fontSize: '12px', marginTop: '4px',
    }, 'グループにログイン'));
  }
  card.appendChild(headerWrap);

  // Error message
  if (errorParam) {
    const errEl = el('div', {
      background: '#1f0a0a', border: '1px solid #7f1d1d', borderRadius: '6px',
      color: C.error, fontSize: '13px', padding: '10px 12px', marginBottom: '16px',
    }, errorParam === 'not_a_member'
      ? 'このメールアドレスはこのグループに登録されていません'
      : 'マジックリンクが無効または期限切れです');
    card.appendChild(errEl);
  }

  // Fetch login policy + OIDC providers for this group
  type LoginPolicy = { allow_standard: number; allow_oidc: number };
  type OidcProvider = { oidc_id: string; name: string | null };

  let policy: LoginPolicy = { allow_standard: 1, allow_oidc: 0 };
  let oidcProviders: OidcProvider[] = [];

  if (groupId) {
    const [policyRes, providersRes] = await Promise.all([
      fetch(`/api/v1/identity/groups/${encodeURIComponent(groupId)}/login-policy`).catch(() => null),
      fetch(`/api/v1/identity/groups/${encodeURIComponent(groupId)}/oidc-providers`).catch(() => null),
    ]);
    if (policyRes?.ok) policy = (await policyRes.json()) as LoginPolicy;
    if (providersRes?.ok) oidcProviders = ((await providersRes.json()) as { providers: OidcProvider[] }).providers;
  }

  // OAuth buttons
  const oauthSection = el('div', { display: 'flex', flexDirection: 'column', gap: '8px' });
  const btnBase: Partial<CSSStyleDeclaration> = {
    display: 'block', padding: '10px 16px', borderRadius: '6px',
    border: `1px solid ${C.border}`, background: '#0f172a', color: C.text,
    fontSize: '14px', cursor: 'pointer', width: '100%', fontFamily: 'monospace',
    textDecoration: 'none', boxSizing: 'border-box', textAlign: 'center',
  };

  // OIDC provider buttons (shown first if configured)
  if (policy.allow_oidc && oidcProviders.length > 0) {
    for (const provider of oidcProviders) {
      const btn = el('a', { ...btnBase, borderColor: C.accent, color: C.bright }, `${provider.name ?? 'IdP'} でログイン`);
      btn.href = `/oauth/oidc/start/${encodeURIComponent(provider.oidc_id)}`;
      oauthSection.appendChild(btn);
    }
  }

  if (policy.allow_standard) {
    for (const [label, href] of [
      ['GitHub でログイン', '/oauth/github/start'],
      ['Google でログイン', '/oauth/google/start'],
      ['Microsoft でログイン', '/oauth/microsoft/start'],
    ] as const) {
      const btn = el('a', { ...btnBase }, label);
      btn.href = href;
      oauthSection.appendChild(btn);
    }
  }

  card.appendChild(oauthSection);

  // Only show divider + magic link form when standard login is allowed
  if (!policy.allow_standard && policy.allow_oidc) {
    root.replaceChildren(card);
    return;
  }

  card.appendChild(divider());

  // Magic link email form
  const emailInput = el('input') as HTMLInputElement;
  Object.assign(emailInput.style, inputStyle);
  emailInput.type = 'email';
  emailInput.placeholder = 'メールアドレス';
  card.appendChild(emailInput);

  const sendBtn = el('button', {
    width: '100%', padding: '10px 16px', background: C.accent, border: 'none',
    borderRadius: '6px', color: '#fff', fontSize: '14px', fontFamily: 'monospace',
    cursor: 'pointer', fontWeight: '600',
  }, 'マジックリンクを送信') as HTMLButtonElement;
  card.appendChild(sendBtn);

  const statusEl = el('div', { marginTop: '12px', fontSize: '13px', textAlign: 'center', minHeight: '20px' });
  card.appendChild(statusEl);

  root.replaceChildren(card);

  const send = async (): Promise<void> => {
    const email = emailInput.value.trim();
    if (!email) {
      statusEl.textContent = 'メールアドレスを入力してください';
      statusEl.style.color = C.error;
      return;
    }
    sendBtn.disabled = true;
    sendBtn.textContent = '確認中...';
    statusEl.textContent = '';

    // Validate membership before sending
    try {
      const checkRes = await fetch(
        `/api/auth/member-check?group_id=${encodeURIComponent(groupId)}&email=${encodeURIComponent(email)}`,
      );
      if (checkRes.status === 404) {
        statusEl.textContent = 'このメールアドレスはこのグループに登録されていません';
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

    sendBtn.textContent = '送信中...';
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose: 'login', group_id: groupId }),
      });
      if (res.ok) {
        statusEl.textContent = 'メールを送信しました。リンクをクリックしてログインしてください。';
        statusEl.style.color = C.success;
        emailInput.disabled = true;
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
};
