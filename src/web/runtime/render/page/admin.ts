const C = {
  bg: '#0f172a',
  surface: '#1e293b',
  border: '#334155',
  text: '#cbd5e1',
  bright: '#f1f5f9',
  dim: '#64748b',
  accent: '#3b82f6',
  success: '#4ade80',
  error: '#f87171',
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

function input(placeholder: string, type = 'text'): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  i.placeholder = placeholder;
  Object.assign(i.style, {
    width: '100%', padding: '8px 10px', background: '#0f172a',
    border: `1px solid ${C.border}`, borderRadius: '6px', color: C.text,
    fontSize: '13px', fontFamily: 'monospace', boxSizing: 'border-box',
    marginBottom: '8px', outline: 'none',
  });
  return i;
}

function btn(label: string, accent = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  Object.assign(b.style, {
    padding: '8px 14px', borderRadius: '6px', fontSize: '13px',
    fontFamily: 'monospace', cursor: 'pointer', border: 'none',
    background: accent ? C.accent : C.surface,
    color: accent ? '#fff' : C.text,
    marginRight: '8px',
  });
  return b;
}

function section(title: string): HTMLElement {
  const wrap = el('div', { marginBottom: '32px' });
  wrap.appendChild(el('h2', {
    color: C.bright, fontSize: '16px', fontWeight: '600', margin: '0 0 16px 0',
    paddingBottom: '8px', borderBottom: `1px solid ${C.border}`,
  }, title));
  return wrap;
}

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

export const renderAdminPage = async (root: HTMLElement): Promise<void> => {
  document.body.style.cssText =
    `background:${C.bg};margin:0;min-height:100vh;font-family:monospace;padding:32px 16px;box-sizing:border-box;`;

  const groupId = getCookie('identity_group_id');

  const wrap = el('div', { maxWidth: '560px', margin: '0 auto' });
  wrap.appendChild(el('h1', { color: C.bright, fontSize: '20px', fontWeight: '700', margin: '0 0 8px 0' }, '管理設定'));
  if (groupId) {
    wrap.appendChild(el('div', { color: C.dim, fontSize: '12px', marginBottom: '32px' }, `グループ: ${groupId}`));
  }

  // ---- OIDC Provider section ----
  const oidcSec = section('OIDC プロバイダー');

  const providerList = el('div', { marginBottom: '16px' });
  oidcSec.appendChild(providerList);

  const statusEl = el('div', { fontSize: '13px', marginBottom: '12px', minHeight: '18px' });
  oidcSec.appendChild(statusEl);

  const refreshProviders = async (): Promise<void> => {
    if (!groupId) return;
    const res = await fetch(`/api/v1/identity/groups/${encodeURIComponent(groupId)}/oidc-providers`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { providers: Array<{ oidc_id: string; name: string | null }> };
    providerList.replaceChildren();
    if (data.providers.length === 0) {
      providerList.appendChild(el('div', { color: C.dim, fontSize: '13px', marginBottom: '8px' }, '登録済みプロバイダーなし'));
    }
    for (const p of data.providers) {
      const row = el('div', {
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 12px', background: C.surface,
        border: `1px solid ${C.border}`, borderRadius: '6px', marginBottom: '6px',
      });
      row.appendChild(el('span', { color: C.bright, flex: '1', fontSize: '13px' }, p.name ?? '(名前なし)'));
      row.appendChild(el('span', { color: C.dim, fontSize: '11px' }, p.oidc_id.slice(0, 8) + '...'));
      const deleteBtn = btn('削除');
      deleteBtn.onclick = async () => {
        if (!confirm(`プロバイダー「${p.name}」を削除しますか？`)) return;
        const r = await fetch(`/api/v1/auth/admin/oidc/${encodeURIComponent(p.oidc_id)}`, { method: 'DELETE' });
        statusEl.textContent = r.ok ? '削除しました' : '削除に失敗しました';
        statusEl.style.color = r.ok ? C.success : C.error;
        void refreshProviders();
      };
      row.appendChild(deleteBtn);
      providerList.appendChild(row);
    }
  };

  // Add provider form
  const addForm = el('div', {
    padding: '16px', background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: '8px', marginBottom: '8px',
  });
  addForm.appendChild(el('div', { color: C.bright, fontSize: '13px', fontWeight: '600', marginBottom: '12px' }, '新規プロバイダー登録'));

  const nameIn = input('表示名（例: LINE WORKS）');
  const issuerIn = input('Issuer URL（例: https://auth.worksmobile.com）');
  const appIdIn = input('OAuth Client ID');
  const appSecretIn = input('OAuth Client Secret', 'password');

  addForm.appendChild(nameIn);
  addForm.appendChild(issuerIn);
  addForm.appendChild(appIdIn);
  addForm.appendChild(appSecretIn);

  const addBtn = btn('登録', true);
  addBtn.onclick = async () => {
    if (!groupId) { statusEl.textContent = 'グループが選択されていません'; statusEl.style.color = C.error; return; }
    if (!nameIn.value || !issuerIn.value || !appIdIn.value || !appSecretIn.value) {
      statusEl.textContent = '全項目を入力してください';
      statusEl.style.color = C.error;
      return;
    }
    addBtn.disabled = true;
    addBtn.textContent = '登録中...';
    const res = await fetch('/api/v1/auth/admin/oidc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nameIn.value.trim(),
        issuer: issuerIn.value.trim(),
        app_id: appIdIn.value.trim(),
        app_secret: appSecretIn.value,
        group_id: groupId,
      }),
    });
    addBtn.disabled = false;
    addBtn.textContent = '登録';
    if (res.ok) {
      statusEl.textContent = '登録しました';
      statusEl.style.color = C.success;
      nameIn.value = '';
      issuerIn.value = '';
      appIdIn.value = '';
      appSecretIn.value = '';
      void refreshProviders();
    } else {
      const body = await res.json().catch(() => ({})) as { error?: string };
      statusEl.textContent = `登録失敗: ${body.error ?? res.status}`;
      statusEl.style.color = C.error;
    }
  };
  addForm.appendChild(addBtn);
  oidcSec.appendChild(addForm);
  wrap.appendChild(oidcSec);

  // ---- Login policy section ----
  const policySec = section('ログイン方式ポリシー');

  let currentPolicy = { allow_standard: 1, allow_oidc: 0 };
  if (groupId) {
    const pRes = await fetch(`/api/v1/auth/admin/login-policy?group_id=${encodeURIComponent(groupId)}`).catch(() => null);
    if (pRes?.ok) currentPolicy = (await pRes.json()) as { allow_standard: number; allow_oidc: number };
  }

  const policyStatusEl = el('div', { fontSize: '13px', minHeight: '18px', marginTop: '12px' });

  const makeCheckbox = (label: string, checked: boolean): { wrap: HTMLElement; cb: HTMLInputElement } => {
    const wrap = el('label', { display: 'flex', alignItems: 'center', gap: '8px', color: C.text, fontSize: '13px', cursor: 'pointer', marginBottom: '8px' });
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode(label));
    return { wrap, cb };
  };

  const { wrap: stdWrap, cb: stdCb } = makeCheckbox('通常ログインを許可（Google / Microsoft / GitHub / マジックリンク）', currentPolicy.allow_standard === 1);
  const { wrap: oidcWrap, cb: oidcCb } = makeCheckbox('OIDC ログインを許可（登録済みプロバイダーを表示）', currentPolicy.allow_oidc === 1);

  policySec.appendChild(stdWrap);
  policySec.appendChild(oidcWrap);

  const saveBtn = btn('保存', true);
  saveBtn.onclick = async () => {
    if (!groupId) { policyStatusEl.textContent = 'グループが選択されていません'; policyStatusEl.style.color = C.error; return; }
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';
    const res = await fetch('/api/v1/auth/admin/login-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: groupId, allow_standard: stdCb.checked ? 1 : 0, allow_oidc: oidcCb.checked ? 1 : 0 }),
    });
    saveBtn.disabled = false;
    saveBtn.textContent = '保存';
    policyStatusEl.textContent = res.ok ? '保存しました' : '保存に失敗しました';
    policyStatusEl.style.color = res.ok ? C.success : C.error;
  };
  policySec.appendChild(saveBtn);
  policySec.appendChild(policyStatusEl);
  wrap.appendChild(policySec);

  root.replaceChildren(wrap);

  // Load providers after rendering
  void refreshProviders();
};
