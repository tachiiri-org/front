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

type AuthStatus = {
  github: { authenticated: boolean; login: string | null };
  google: { authenticated: boolean; email: string | null };
  microsoft: { authenticated: boolean; email: string | null };
};

export const renderSettingsPage = async (root: HTMLElement): Promise<void> => {
  document.body.style.cssText =
    `background:${C.bg};margin:0;display:flex;align-items:flex-start;justify-content:center;min-height:100vh;font-family:monospace;padding:32px 16px;box-sizing:border-box;`;
  Object.assign(root.style, {
    width: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', boxSizing: 'border-box',
  });

  root.replaceChildren(el('div', { color: C.dim, fontSize: '14px' }, '読み込み中...'));

  const authRes = await fetch('/api/v1/auth/status').catch(() => null);
  const auth = authRes?.ok ? (await authRes.json() as AuthStatus) : null;

  const wrap = el('div', { width: '100%', maxWidth: '480px', boxSizing: 'border-box' });

  wrap.appendChild(el('h1', {
    color: C.bright, fontSize: '22px', fontWeight: '700', margin: '0 0 24px 0',
  }, '設定'));

  // Auth providers section
  const section = el('div', {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px',
    padding: '24px', marginBottom: '16px',
  });
  section.appendChild(el('h2', {
    color: C.bright, fontSize: '15px', fontWeight: '600', margin: '0 0 16px 0',
  }, '連携済みアカウント'));

  const providers: { key: keyof AuthStatus; label: string; startPath: string; identity: string | null }[] = [
    {
      key: 'github',
      label: 'GitHub',
      startPath: '/oauth/github/start',
      identity: auth?.github.login ? `@${auth.github.login}` : null,
    },
    {
      key: 'google',
      label: 'Google',
      startPath: '/oauth/google/start',
      identity: auth?.google.email ?? null,
    },
    {
      key: 'microsoft',
      label: 'Microsoft',
      startPath: '/oauth/microsoft/start',
      identity: auth?.microsoft.email ?? null,
    },
  ];

  for (const p of providers) {
    const row = el('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0', borderBottom: `1px solid ${C.border}`,
    });
    row.style.borderBottom = `1px solid ${C.border}`;

    const left = el('div');
    left.appendChild(el('span', { color: C.bright, fontSize: '14px', display: 'block' }, p.label));
    if (p.identity) {
      left.appendChild(el('span', { color: C.dim, fontSize: '12px' }, p.identity));
    }
    row.appendChild(left);

    if (!auth?.[p.key].authenticated) {
      const linkBtn = el('button', {
        padding: '6px 14px', background: 'transparent', border: `1px solid ${C.border}`,
        borderRadius: '6px', color: C.text, fontSize: '12px', fontFamily: 'monospace',
        cursor: 'pointer',
      }, '連携');
      linkBtn.addEventListener('click', () => {
        // Set link mode cookie then navigate to OAuth start
        document.cookie = `identity_link_mode=true; Path=/; Max-Age=600; SameSite=Lax`;
        window.location.href = p.startPath;
      });
      row.appendChild(linkBtn);
    } else {
      row.appendChild(el('span', { color: C.success, fontSize: '12px' }, '連携済み'));
    }

    section.appendChild(row);
  }

  // Remove last border
  const rows = section.querySelectorAll('div[style*="border-bottom"]');
  const last = rows[rows.length - 1];
  if (last instanceof HTMLElement) last.style.borderBottom = 'none';

  wrap.appendChild(section);

  // Back link
  const back = el('a', {
    color: C.dim, fontSize: '13px', textDecoration: 'none', display: 'inline-block', marginTop: '8px',
  }, '← 戻る');
  back.href = '/';
  wrap.appendChild(back);

  root.replaceChildren(wrap);
};
