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

export const renderLoginPage = (root: HTMLElement): void => {
  document.body.style.cssText =
    `background:${C.bg};margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:monospace;`;
  Object.assign(root.style, {
    width: '100%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: '16px', boxSizing: 'border-box',
  });

  const params = new URLSearchParams(window.location.search);
  const nextParam = params.get('next');
  const orgParam = params.get('org');
  const errorParam = params.get('error');
  const isOrgCreate = nextParam === 'org_create';

  // Persist org context and intent through OAuth flow via cookies
  if (orgParam) {
    document.cookie = `magic_org_id=${encodeURIComponent(orgParam)}; Path=/; Max-Age=600; SameSite=Lax`;
  }
  if (isOrgCreate) {
    document.cookie = `login_intent=org_create; Path=/; Max-Age=600; SameSite=Lax`;
  }

  const card = el('div', {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px',
    padding: '32px', width: '100%', maxWidth: '360px', boxSizing: 'border-box',
  });

  card.appendChild(el('h1', {
    color: C.bright, fontSize: '24px', fontWeight: '700',
    margin: '0 0 24px 0', textAlign: 'center',
  }, 'Tempri'));

  if (errorParam === 'invalid_magic_link') {
    card.appendChild(el('div', {
      background: '#1f0a0a', border: '1px solid #7f1d1d', borderRadius: '6px',
      color: C.error, fontSize: '13px', padding: '10px 12px', marginBottom: '16px',
    }, 'マジックリンクが無効または期限切れです'));
  }

  if (isOrgCreate) {
    card.appendChild(el('div', {
      color: C.dim, fontSize: '13px', marginBottom: '16px', textAlign: 'center',
    }, '新しい組織を作成するためにログインしてください'));
  } else if (orgParam) {
    card.appendChild(el('div', {
      color: C.dim, fontSize: '13px', marginBottom: '16px', textAlign: 'center',
    }, '組織専用ログイン'));
  }

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

  // Magic link form
  const emailInput = el('input');
  Object.assign(emailInput.style, {
    width: '100%', padding: '10px 12px', background: '#0f172a',
    border: `1px solid ${C.border}`, borderRadius: '6px', color: C.text,
    fontSize: '14px', fontFamily: 'monospace', boxSizing: 'border-box',
    marginBottom: '8px', outline: 'none',
  });
  emailInput.type = 'email';
  emailInput.placeholder = 'メールアドレス';
  card.appendChild(emailInput);

  const sendBtn = el('button', {
    width: '100%', padding: '10px 16px', background: C.accent, border: 'none',
    borderRadius: '6px', color: '#fff', fontSize: '14px', fontFamily: 'monospace',
    cursor: 'pointer', fontWeight: '600',
  }, 'マジックリンクを送信');
  card.appendChild(sendBtn);

  const status = el('div', {
    marginTop: '12px', fontSize: '13px', textAlign: 'center', minHeight: '20px',
  });
  card.appendChild(status);

  const purpose = isOrgCreate ? 'org_create' : 'login';

  const send = async (): Promise<void> => {
    const email = emailInput.value.trim();
    if (!email) {
      status.textContent = 'メールアドレスを入力してください';
      status.style.color = C.error;
      return;
    }
    sendBtn.disabled = true;
    sendBtn.textContent = '送信中...';
    status.textContent = '';
    try {
      const body: Record<string, string> = { email, purpose };
      if (orgParam) body.org_id = orgParam;
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        status.textContent = 'メールを送信しました。リンクをクリックしてログインしてください。';
        status.style.color = C.success;
        emailInput.disabled = true;
        sendBtn.textContent = '送信済み';
      } else {
        status.textContent = 'エラーが発生しました。もう一度お試しください。';
        status.style.color = C.error;
        sendBtn.disabled = false;
        sendBtn.textContent = 'マジックリンクを送信';
      }
    } catch {
      status.textContent = 'ネットワークエラーが発生しました。';
      status.style.color = C.error;
      sendBtn.disabled = false;
      sendBtn.textContent = 'マジックリンクを送信';
    }
  };

  sendBtn.addEventListener('click', () => void send());
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void send(); });

  root.replaceChildren(card);
};
