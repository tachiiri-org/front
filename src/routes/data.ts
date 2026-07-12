import type { SpecDocument } from '../shared/spec-document';
import type { UiShellSettings } from '../shared/ui-shell-settings';
import { readGitHubSession, readGitHubConnectSession, readGoogleSession, readMicrosoftSession, readOidcSession, listUserOrganizations, createOrganization, resolveOrgUser, getDefaultGroup, verifyMagicLinkToken, createBareUser, findMemberByEmail, registerGroupMember, fetchGroupInfo, setGroupName, resolveGroupName } from '../identify';
import { parseCookies, serializeCookie } from '../session/cookies';
import { readIdentity, identitySetCookies } from '../session/identity';
import { authorizeFetch } from '../session/fetch';
import { OIDC_ORG_ID_COOKIE } from '../session/oidc';
import type { AuthorizeEnv } from '../session';

type StoredObject = {
  text(): Promise<string>;
};

export type LayoutsBucket = {
  get(key: string): Promise<StoredObject | null>;
  put(
    key: string,
    value: string,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
    },
  ): Promise<unknown>;
};

type ApiEnv = {
  readonly LAYOUTS?: LayoutsBucket;
};

const SPEC_DOCUMENT_KEY = 'spec-document.json';
const UI_SHELL_SETTINGS_KEY = 'ui-shell-settings.json';

const json = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...init?.headers,
    },
  });

const readJson = async <T>(object: StoredObject): Promise<T> => {
  return JSON.parse(await object.text()) as T;
};

const requireLayouts = (env: ApiEnv): LayoutsBucket | Response => {
  if (!env.LAYOUTS) {
    return json({ error: 'layouts_not_configured' }, { status: 503 });
  }

  return env.LAYOUTS;
};

const handleGet = async <T>(
  bucket: LayoutsBucket,
  key: string,
  fallback: T,
): Promise<Response> => {
  const object = await bucket.get(key);

  if (!object) {
    return json(fallback, { status: 200 });
  }

  return json(await readJson<T>(object), { status: 200 });
};

const handlePut = async <T>(
  request: Request,
  bucket: LayoutsBucket,
  key: string,
): Promise<Response> => {
  const value = (await request.json()) as T;

  await bucket.put(key, `${JSON.stringify(value, null, 2)}\n`, {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
    },
  });

  return json(value, { status: 200 });
};

export async function handleApiRequest(request: Request, env: ApiEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const bucket = requireLayouts(env);

  if (bucket instanceof Response) {
    return bucket;
  }

  if (pathname === '/api/v1/spec-document') {
    if (request.method === 'GET') {
      return handleGet<SpecDocument | null>(bucket, SPEC_DOCUMENT_KEY, null);
    }
    if (request.method === 'PUT') {
      return handlePut<SpecDocument>(request, bucket, SPEC_DOCUMENT_KEY);
    }
  }

  if (pathname === '/api/v1/ui-shell-settings') {
    if (request.method === 'GET') {
      return handleGet<UiShellSettings>(bucket, UI_SHELL_SETTINGS_KEY, { topics: {} });
    }
    if (request.method === 'PUT') {
      return handlePut<UiShellSettings>(request, bucket, UI_SHELL_SETTINGS_KEY);
    }
  }

  return null;
}

export async function handleGitHubAuthStatus(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/v1/auth/github/status') {
    return null;
  }

  try {
    const session = await readGitHubSession(request, env);
    return json(
      {
        authenticated: Boolean(session),
        login: session?.viewer.login ?? null,
      },
      { status: 200 },
    );
  } catch {
    return json({ authenticated: false, login: null }, { status: 200 });
  }
}

export async function handleAuthStatus(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/v1/auth/status') {
    return null;
  }

  const [githubResult, githubConnectResult, googleResult, microsoftResult, oidcResult] = await Promise.allSettled([
    readGitHubSession(request, env),
    readGitHubConnectSession(request, env),
    readGoogleSession(request, env),
    readMicrosoftSession(request, env),
    readOidcSession(request, env),
  ]);

  const githubSession = githubResult.status === 'fulfilled' ? githubResult.value : null;
  const githubConnectSession = githubConnectResult.status === 'fulfilled' ? githubConnectResult.value : null;
  const googleSession = googleResult.status === 'fulfilled' ? googleResult.value : null;
  const microsoftSession = microsoftResult.status === 'fulfilled' ? microsoftResult.value : null;
  const oidcSession = oidcResult.status === 'fulfilled' ? oidcResult.value : null;

  return json(
    {
      github: {
        authenticated: Boolean(githubSession),
        login: githubSession?.viewer.login ?? null,
      },
      githubConnect: {
        authenticated: Boolean(githubConnectSession),
        scopes: githubConnectSession?.scopes ?? null,
      },
      // email/name は返さない（P2 を出さない）。連携の有無のみ。表示に email が要る場合は
      // group DB の検証済み email を本人にのみ出す（別途）。
      google: {
        authenticated: Boolean(googleSession),
      },
      microsoft: {
        authenticated: Boolean(microsoftSession),
      },
      oidc: {
        authenticated: Boolean(oidcSession),
      },
    },
    { status: 200 },
  );
}

export async function handleIdentityStatus(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/v1/auth/identity-status') {
    return null;
  }

  const identity = await readIdentity(env, request);
  const userId = identity?.userId ?? null;

  if (!identity || !userId) {
    return json({ user_id: null, organizations: [] }, { status: 200 });
  }

  // Refresh the signed identity (and its group hint) TTL.
  const refreshCookies = await identitySetCookies(env, identity);
  const withRefresh = (res: Response): Response => {
    for (const c of refreshCookies) res.headers.append('Set-Cookie', c);
    return res;
  };

  try {
    const organizations = await listUserOrganizations(env, userId);
    return withRefresh(json({ user_id: userId, organizations }, { status: 200 }));
  } catch {
    return withRefresh(json({ user_id: userId, organizations: [] }, { status: 200 }));
  }
}

export async function handleAutoSelectOrg(request: Request, env: AuthorizeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/auth/auto-select-org' || request.method !== 'GET') {
    return null;
  }

  const cookies = parseCookies(request);
  const userId = (await readIdentity(env, request))?.userId;
  if (!userId) {
    return json({ error: 'not_authenticated' }, { status: 401 });
  }

  const magicGroupId = cookies.get('magic_group_id') ? decodeURIComponent(cookies.get('magic_group_id')!) : null;
  const groupId = magicGroupId ?? (await getDefaultGroup(env, userId).catch(() => null));
  if (!groupId) {
    return json({ group_id: null }, { status: 404 });
  }

  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });

  // email→group DB 登録は OAuth callback / magic-link verify で完了済み。ここでは email を扱わない
  // （P2 を cookie に持たせない）。group_id は非PII なので選択誘導にのみ使う。
  const orgUser = await resolveOrgUser(env, groupId, userId);
  for (const c of await identitySetCookies(env, { userId, groupId, orgUserId: orgUser?.orgUserId })) {
    headers.append('Set-Cookie', c);
  }
  if (magicGroupId) {
    headers.append('Set-Cookie', `magic_group_id=; Path=/; Max-Age=0`);
  }

  return new Response(JSON.stringify({ group_id: groupId }), { status: 200, headers });
}

export async function handleSelectOrg(request: Request, env: AuthorizeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/auth/select-org' || request.method !== 'GET') {
    return null;
  }

  const orgId = url.searchParams.get('group_id');
  if (!orgId) {
    return json({ error: 'group_id_required' }, { status: 400 });
  }

  const returnTo = url.searchParams.get('returnTo') ?? '';
  const cookies = parseCookies(request);
  const identityUserId = (await readIdentity(env, request))?.userId;
  const headers = new Headers();
  headers.set('Location', returnTo.startsWith('/') ? returnTo : '/');

  if (identityUserId) {
    // email→group DB 登録は OAuth callback / magic-link verify で完了済み。ここでは email を扱わない
    // （P2 を cookie に持たせない）。
    const orgUser = await resolveOrgUser(env, orgId, identityUserId);
    for (const c of await identitySetCookies(env, { userId: identityUserId, groupId: orgId, orgUserId: orgUser?.orgUserId })) {
      headers.append('Set-Cookie', c);
    }
    const hadMagicGroupId = cookies.get('magic_group_id');
    if (hadMagicGroupId) {
      headers.append('Set-Cookie', `magic_group_id=; Path=/; Max-Age=0`);
    }
  }

  return new Response(null, { status: 302, headers });
}

export async function handleOrgCreate(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/v1/auth/organizations' || request.method !== 'POST') {
    return null;
  }

  const userId = (await readIdentity(env, request))?.userId;
  if (!userId) {
    return json({ error: 'not_authenticated' }, { status: 401 });
  }

  const body = (await request.json()) as { name?: string };
  if (!body.name) {
    return json({ error: 'name_required' }, { status: 400 });
  }

  const org = await createOrganization(env, userId, body.name);
  return json(org, { status: 201 });
}

// PUT /api/v1/auth/organizations/:id/name — グループ名を group DB に設定/リネーム。
// 認可: ログイン中かつ当該グループのメンバーであること（自分の所属外は変更不可）。
export async function handleOrgRename(request: Request, env: AuthorizeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/api\/v1\/auth\/organizations\/([^/]+)\/name$/);
  if (!m || request.method !== 'PUT') return null;

  const userId = (await readIdentity(env, request))?.userId;
  if (!userId) return json({ error: 'not_authenticated' }, { status: 401 });

  const groupId = decodeURIComponent(m[1]);
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name) return json({ error: 'name_required' }, { status: 400 });

  const orgs = await listUserOrganizations(env, userId).catch(() => [] as { id: string }[]);
  if (!orgs.some((o) => o.id === groupId)) return json({ error: 'forbidden' }, { status: 403 });

  await setGroupName(env, groupId, name);
  return json({ id: groupId, name }, { status: 200 });
}

export async function handleOrgMembers(request: Request, env: AuthorizeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/v1/auth/members')) return null;

  // Members are the users of the selected group; the tenant is the group. Trust only the
  // signed identity for the group and org-user — never the JS-readable hint cookie.
  const identity = await readIdentity(env, request);
  const groupId = identity?.groupId;
  const orgUserId = identity?.orgUserId;
  if (!groupId) {
    return json({ error: 'not_authenticated' }, { status: 401 });
  }

  const backendPath = url.pathname.replace('/api/v1/auth/members', '/api/v1/graph/members') + url.search;
  const bodyText = request.body ? await request.text() : undefined;

  const res = await authorizeFetch(env, {
    path: backendPath,
    method: request.method,
    body: bodyText,
    tenantContext: { tenantId: groupId, subjectId: orgUserId ?? undefined },
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function handleMagicLinkRequest(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/auth/magic-link' || request.method !== 'POST') return null;

  const body = (await request.json()) as {
    email?: string; purpose?: string; group_id?: string; group_name?: string; turnstile_token?: string;
  };

  const rawSecret = env.TURNSTILE_SECRET_KEY;
  const secretKey = rawSecret
    ? (typeof rawSecret === 'string' ? rawSecret : await rawSecret.get())
    : null;

  if (secretKey) {
    const token = body.turnstile_token ?? '';
    if (!token) {
      return new Response(JSON.stringify({ error: 'turnstile_required' }), {
        status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    const valid = await verifyTurnstileToken(token, secretKey, request.headers.get('CF-Connecting-IP') ?? undefined);
    if (!valid) {
      return new Response(JSON.stringify({ error: 'turnstile_failed' }), {
        status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  }

  const { turnstile_token: _t, ...forwardBody } = body;
  const res = await authorizeFetch(env, {
    path: '/api/v1/identity/magic-link/request',
    method: 'POST',
    body: JSON.stringify({ ...forwardBody, frontend_origin: url.origin }),
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

// GET /auth/magic?token=xxx
// Verifies magic link token, issues identity_user_id, and redirects directly into the app.
export async function handleMagicLinkVerify(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/auth/magic') return null;

  const token = url.searchParams.get('token');
  if (!token) return new Response('Missing token', { status: 400 });

  const result = await verifyMagicLinkToken(env, token);
  if (!result) {
    return new Response(null, { status: 302, headers: { Location: '/login?error=invalid_magic_link' } });
  }

  const isSecure = url.protocol === 'https:';
  const shortCookieOpts = `Path=/; Max-Age=600; SameSite=Lax; HttpOnly${isSecure ? '; Secure' : ''}`;
  const headers = new Headers();

  try {
    if (result.purpose === 'group_create' && result.group_name) {
      // Create user + group, register email in group DB
      const userId = await createBareUser(env);
      const org = await createOrganization(env, userId, result.group_name);
      await registerGroupMember(env, org.id, result.email, userId);

      for (const c of await identitySetCookies(env, { userId })) headers.append('Set-Cookie', c);
      // email(P2) は cookie に載せない。登録はこの verify 内で完了済み。group_id は非PIIなので選択誘導に残す。
      headers.append('Set-Cookie', `magic_group_id=${encodeURIComponent(org.id)}; ${shortCookieOpts}`);
      headers.append('Set-Cookie', `login_intent=; Path=/; Max-Age=0`);
      headers.set('Location', '/group-select');
      return new Response(null, { status: 302, headers });
    }

    if (result.purpose === 'login' && result.group_id) {
      // Look up identity_user_id from group's member list
      const userId = await findMemberByEmail(env, result.group_id, result.email);
      if (!userId) {
        return new Response(null, { status: 302, headers: { Location: '/login?error=not_a_member' } });
      }

      for (const c of await identitySetCookies(env, { userId })) headers.append('Set-Cookie', c);
      // email(P2) は cookie に載せない。login はメンバー確認のみで登録は既存。group_id は非PIIなので残す。
      headers.append('Set-Cookie', `magic_group_id=${encodeURIComponent(result.group_id)}; ${shortCookieOpts}`);
      headers.set('Location', '/group-select');
      return new Response(null, { status: 302, headers });
    }
  } catch {
    return new Response(null, { status: 302, headers: { Location: '/login?error=invalid_magic_link' } });
  }

  // General login (no org context): OAuth へ戻す。email(P2) は cookie に載せない
  // （OAuth callback 側で email を group DB へ登録する＝Phase1）。
  headers.set('Location', '/login');
  return new Response(null, { status: 302, headers });
}

// GET /api/v1/auth/member-check?group_id=xxx&email=yyy
// Pre-login check: is this email registered in the group? Returns { user_id } or 404.
export async function handleMemberCheck(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/auth/member-check' || request.method !== 'GET') return null;

  const groupId = url.searchParams.get('group_id');
  const email = url.searchParams.get('email');
  if (!groupId || !email) {
    return new Response(JSON.stringify({ error: 'group_id_and_email_required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const userId = await findMemberByEmail(env, groupId, email);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ user_id: userId }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function verifyTurnstileToken(token: string, secretKey: string, ip?: string): Promise<boolean> {
  const body = new FormData();
  body.append('secret', secretKey);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const data = await res.json() as { success: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

function buildLoginShellHtml(clientJsPath: string, siteKey: string, title: string, inlineScript = ''): string {
  const turnstileScript = siteKey
    ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>`
    : '';
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<script>window.__TURNSTILE_SITE_KEY__=${JSON.stringify(siteKey)}</script>
${turnstileScript}
</head>
<body>
${inlineScript}
<script type="module" src="${escHtml(clientJsPath)}"></script>
</body>
</html>`;
}

// GET /login — server-renders login page with Turnstile site key injected
export function handleLoginPage(
  request: Request,
  env: AuthorizeEnv,
  clientJsPath: string,
): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== '/login' || request.method !== 'GET') return null;
  const siteKey = env.TURNSTILE_SITE_KEY ?? '';
  return new Response(buildLoginShellHtml(clientJsPath, siteKey, 'Tempri'), {
    headers: { 'Content-Type': 'text/html; charset=UTF-8' },
  });
}

// GET /api/v1/auth/org-groups?org_id=... — proxies org group list from identity backend
export async function handleOrgGroupsApi(request: Request, env: AuthorizeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/auth/org-groups' || request.method !== 'GET') return null;
  const orgId = url.searchParams.get('org_id');
  if (!orgId) return new Response(JSON.stringify({ error: 'org_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const res = await authorizeFetch(env, {
    path: `/api/v1/identity/orgs/${encodeURIComponent(orgId)}/groups`,
    method: 'GET',
  });
  if (!res.ok) return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  return new Response(await res.text(), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// GET /org-group-select?org_id=... — server-renders org group selection page
export async function handleOrgGroupSelectPage(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/org-group-select' || request.method !== 'GET') return null;
  const orgId = url.searchParams.get('org_id');
  if (!orgId) return new Response('Missing org_id', { status: 400 });
  const returnTo = url.searchParams.get('returnTo') ?? '';

  const res = await authorizeFetch(env, {
    path: `/api/v1/identity/orgs/${encodeURIComponent(orgId)}/groups`,
    method: 'GET',
  });
  // 名前は group DB を正とする（認証DBは id のみ返す）。各グループ名を group DB から解決。
  const groupIds: string[] = res.ok
    ? ((await res.json()) as { groups: Array<{ id: string }> }).groups.map((g) => g.id)
    : [];
  const groups = await Promise.all(
    groupIds.map(async (id) => ({ id, name: (await resolveGroupName(env, id)) ?? id })),
  );

  const safeReturnTo = returnTo.startsWith('/') ? returnTo : '/';
  const items = groups
    .map((g) => {
      const dest = `/api/v1/auth/select-org?org_id=${encodeURIComponent(g.id)}${safeReturnTo !== '/' ? `&returnTo=${encodeURIComponent(safeReturnTo)}` : ''}`;
      return `<li><a href="${escHtml(dest)}">${escHtml(g.name)}</a></li>`;
    })
    .join('\n');
  const body = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>グループを選択 - Tempri</title>
<style>body{font-family:sans-serif;max-width:400px;margin:80px auto;padding:0 16px}ul{list-style:none;padding:0}li{margin:8px 0}a{display:block;padding:12px 16px;border:1px solid #ddd;border-radius:6px;text-decoration:none;color:#333}a:hover{background:#f5f5f5}</style>
</head>
<body>
<h1>グループを選択</h1>
${items.length ? `<ul>\n${items}\n</ul>` : '<p>グループが見つかりません。</p>'}
</body>
</html>`;
  return new Response(body, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

// GET /login/:groupId — server-renders group-specific login page with injected group info
export async function handleGroupLoginPage(
  request: Request,
  env: AuthorizeEnv,
  clientJsPath: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/login\/([0-9a-f-]{36})$/i);
  if (!match || request.method !== 'GET') return null;

  const groupId = match[1];
  const info = await fetchGroupInfo(env, groupId).catch(() => null);

  const payload = JSON.stringify({ id: groupId, name: info?.name ?? null });
  const safeJson = payload.replace(/<\/script>/gi, '<\\/script>');
  const title = info?.name ? `${escHtml(info.name)} - Tempri` : 'Tempri';
  const siteKey = env.TURNSTILE_SITE_KEY ?? '';

  const groupScript = `<script id="__group_data__" type="application/json">\n${safeJson}\n</script>`;
  return new Response(buildLoginShellHtml(clientJsPath, siteKey, title, groupScript), {
    headers: { 'Content-Type': 'text/html; charset=UTF-8' },
  });
}

// GET /login/:org-slug — look up org by slug and redirect to SSO flow
export async function handleOrgSlugLogin(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/login\/([a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/i);
  // Exclude UUID pattern (handled by handleGroupLoginPage)
  if (!match || /^[0-9a-f-]{36}$/i.test(match[1]) || request.method !== 'GET') return null;

  const slug = match[1].toLowerCase();
  const res = await authorizeFetch(env, {
    path: `/api/v1/identity/orgs/by-slug/${encodeURIComponent(slug)}`,
    method: 'GET',
  });

  if (res.status === 404) {
    return new Response('Organization not found', { status: 404 });
  }
  if (!res.ok) {
    return new Response('Failed to look up organization', { status: 502 });
  }

  const org = (await res.json()) as { id: string; sso_type: string | null; sso_id: string | null };

  if (org.sso_type === 'oidc' && org.sso_id) {
    const returnTo = url.searchParams.get('returnTo') ?? '';
    const dest = `/oauth/oidc/start/${encodeURIComponent(org.sso_id)}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
    return new Response(null, { status: 302, headers: new Headers({ Location: dest }) });
  }

  if (org.sso_type === 'saml' && org.sso_id) {
    const dest = `/auth/saml/${encodeURIComponent(slug)}/sso`;
    return new Response(null, { status: 302, headers: new Headers({ Location: dest }) });
  }

  return new Response('No SSO configured for this organization', { status: 404 });
}
