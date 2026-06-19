const C = {
  bg: '#0f172a',
  surface: '#1e293b',
  border: '#334155',
  text: '#cbd5e1',
  bright: '#f1f5f9',
  dim: '#64748b',
  accent: '#3b82f6',
  accentHover: '#2563eb',
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

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function clearCookieClient(name: string): void {
  document.cookie = `${name}=; Path=/; Max-Age=0`;
}

type Identity = {
  user_id: string | null;
  organizations: { id: string; name: string }[];
};

export const renderGroupSelectPage = async (root: HTMLElement): Promise<void> => {
  document.body.style.cssText =
    `background:${C.bg};margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:monospace;`;
  Object.assign(root.style, {
    width: '100%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: '16px', boxSizing: 'border-box',
  });

  // Show spinner while loading
  root.replaceChildren(el('div', { color: C.dim, fontSize: '14px' }, '読み込み中...'));

  const identityRes = await fetch('/api/v1/auth/identity-status').catch(() => null);
  const identity = identityRes?.ok ? (await identityRes.json() as Identity) : null;
  if (!identity?.user_id) {
    window.location.href = '/login';
    return;
  }

  const loginIntent = getCookie('login_intent');
  const isOrgCreate = loginIntent === 'group_create';
  const returnTo = new URLSearchParams(window.location.search).get('returnTo') ?? '';

  // Try auto-select unless we're in org-create mode
  if (!isOrgCreate) {
    const autoRes = await fetch('/api/v1/auth/auto-select-org').catch(() => null);
    if (autoRes?.ok) {
      clearCookieClient('login_intent');
      window.location.href = returnTo.startsWith('/') ? returnTo : '/';
      return;
    }
  }

  // Render full UI
  const card = el('div', {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px',
    padding: '32px', width: '100%', maxWidth: '400px', boxSizing: 'border-box',
  });

  const title = isOrgCreate ? '新しいグループを作成' : 'グループを選択';
  card.appendChild(el('h1', {
    color: C.bright, fontSize: '22px', fontWeight: '700',
    margin: '0 0 24px 0', textAlign: 'center',
  }, title));

  const status = el('div', { fontSize: '13px', textAlign: 'center', minHeight: '20px', marginBottom: '8px' });
  card.appendChild(status);

  // Org list (if not org-create mode and orgs exist)
  if (!isOrgCreate && identity.organizations.length > 0) {
    const listSection = el('div', { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '20px' });
    for (const org of identity.organizations) {
      const row = el('button', {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', background: '#0f172a', border: `1px solid ${C.border}`,
        borderRadius: '6px', color: C.text, fontSize: '14px', fontFamily: 'monospace',
        cursor: 'pointer', width: '100%', textAlign: 'left',
      });
      row.appendChild(el('span', { color: C.bright }, org.name));
      row.appendChild(el('span', { color: C.dim }, '→'));
      row.addEventListener('click', () => {
        const returnToParam = returnTo.startsWith('/') ? `&returnTo=${encodeURIComponent(returnTo)}` : '';
        window.location.href = `/api/v1/auth/select-org?group_id=${encodeURIComponent(org.id)}${returnToParam}`;
      });
      listSection.appendChild(row);
    }
    card.appendChild(listSection);

    const sep = el('div', {
      display: 'flex', alignItems: 'center', gap: '12px',
      margin: '0 0 20px 0', color: C.dim, fontSize: '12px',
    });
    const line = () => el('div', { flex: '1', height: '1px', background: C.border });
    sep.appendChild(line());
    sep.appendChild(el('span', {}, '新しいグループを作成'));
    sep.appendChild(line());
    card.appendChild(sep);
  }

  // Org creation form
  const nameInput = el('input');
  Object.assign(nameInput.style, {
    width: '100%', padding: '10px 12px', background: '#0f172a',
    border: `1px solid ${C.border}`, borderRadius: '6px', color: C.text,
    fontSize: '14px', fontFamily: 'monospace', boxSizing: 'border-box',
    marginBottom: '8px', outline: 'none',
  });
  nameInput.type = 'text';
  nameInput.placeholder = 'グループ名';
  card.appendChild(nameInput);

  const createBtn = el('button', {
    width: '100%', padding: '10px 16px', background: C.accent, border: 'none',
    borderRadius: '6px', color: '#fff', fontSize: '14px', fontFamily: 'monospace',
    cursor: 'pointer', fontWeight: '600',
  }, '作成');
  card.appendChild(createBtn);
  card.appendChild(status);

  const create = async (): Promise<void> => {
    const name = nameInput.value.trim();
    if (!name) {
      status.textContent = 'グループ名を入力してください';
      status.style.color = C.error;
      return;
    }
    createBtn.disabled = true;
    createBtn.textContent = '作成中...';
    status.textContent = '';
    try {
      const res = await fetch('/api/v1/auth/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const org = (await res.json()) as { id: string; name: string };
        clearCookieClient('login_intent');
        const returnToParam = returnTo.startsWith('/') ? `&returnTo=${encodeURIComponent(returnTo)}` : '';
        window.location.href = `/api/v1/auth/select-org?group_id=${encodeURIComponent(org.id)}${returnToParam}`;
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        status.textContent = data.error === 'name_required' ? 'グループ名を入力してください' : 'エラーが発生しました';
        status.style.color = C.error;
        createBtn.disabled = false;
        createBtn.textContent = '作成';
      }
    } catch {
      status.textContent = 'ネットワークエラーが発生しました。';
      status.style.color = C.error;
      createBtn.disabled = false;
      createBtn.textContent = '作成';
    }
  };

  createBtn.addEventListener('click', () => void create());
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void create(); });

  root.replaceChildren(card);
};
