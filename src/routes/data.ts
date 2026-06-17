import type { SpecDocument } from '../shared/spec-document';
import type { UiShellSettings } from '../shared/ui-shell-settings';
import { readGitHubSession, readGitHubConnectSession, readGoogleSession, readMicrosoftSession, listUserOrganizations, createOrganization, resolveOrgUser, getDefaultGroup, verifyMagicLinkToken, createBareUser, findMemberByEmail, registerGroupMember, fetchGroupInfo } from '../identify';
import { parseCookies } from '../session/cookies';
import { authorizeFetch } from '../session/fetch';
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

  if (pathname === '/api/spec-document') {
    if (request.method === 'GET') {
      return handleGet<SpecDocument | null>(bucket, SPEC_DOCUMENT_KEY, null);
    }
    if (request.method === 'PUT') {
      return handlePut<SpecDocument>(request, bucket, SPEC_DOCUMENT_KEY);
    }
  }

  if (pathname === '/api/ui-shell-settings') {
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
  if (new URL(request.url).pathname !== '/api/auth/github/status') {
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
  if (new URL(request.url).pathname !== '/api/auth/status') {
    return null;
  }

  const [githubResult, githubConnectResult, googleResult, microsoftResult] = await Promise.allSettled([
    readGitHubSession(request, env),
    readGitHubConnectSession(request, env),
    readGoogleSession(request, env),
    readMicrosoftSession(request, env),
  ]);

  const githubSession = githubResult.status === 'fulfilled' ? githubResult.value : null;
  const githubConnectSession = githubConnectResult.status === 'fulfilled' ? githubConnectResult.value : null;
  const googleSession = googleResult.status === 'fulfilled' ? googleResult.value : null;
  const microsoftSession = microsoftResult.status === 'fulfilled' ? microsoftResult.value : null;

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
      google: {
        authenticated: Boolean(googleSession),
        email: googleSession?.email ?? null,
        name: googleSession?.name ?? null,
      },
      microsoft: {
        authenticated: Boolean(microsoftSession),
        email: microsoftSession?.email ?? null,
        name: microsoftSession?.name ?? null,
      },
    },
    { status: 200 },
  );
}

export async function handleIdentityStatus(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/auth/identity-status') {
    return null;
  }

  const cookies = parseCookies(request);
  const userId = cookies.get('identity_user_id') ?? null;

  if (!userId) {
    return json({ user_id: null, organizations: [] }, { status: 200 });
  }

  try {
    const organizations = await listUserOrganizations(env, userId);
    return json({ user_id: userId, organizations }, { status: 200 });
  } catch {
    return json({ user_id: userId, organizations: [] }, { status: 200 });
  }
}

export async function handleAutoSelectOrg(request: Request, env: AuthorizeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/auth/auto-select-org' || request.method !== 'GET') {
    return null;
  }

  const cookies = parseCookies(request);
  const userId = cookies.get('identity_user_id');
  if (!userId) {
    return json({ error: 'not_authenticated' }, { status: 401 });
  }

  const magicGroupId = cookies.get('magic_group_id') ? decodeURIComponent(cookies.get('magic_group_id')!) : null;
  const groupId = magicGroupId ?? (await getDefaultGroup(env, userId).catch(() => null));
  if (!groupId) {
    return json({ group_id: null }, { status: 404 });
  }

  const isSecure = url.protocol === 'https:';
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  headers.append('Set-Cookie', `identity_group_id=${encodeURIComponent(groupId)}; Path=/; Max-Age=${60 * 60 * 24}${isSecure ? '; Secure' : ''}; SameSite=Lax`);

  const magicEmail = cookies.get('magic_email') ? decodeURIComponent(cookies.get('magic_email')!) : null;
  const [githubSession, googleSession] = await Promise.allSettled([
    readGitHubSession(request, env),
    readGoogleSession(request, env),
  ]);
  const email = magicEmail ??
    (githubSession.status === 'fulfilled' ? githubSession.value?.email : null) ??
    (googleSession.status === 'fulfilled' ? googleSession.value?.email : null);

  if (email) {
    const orgUser = await resolveOrgUser(env, groupId, userId, email);
    if (orgUser) {
      headers.append('Set-Cookie', `org_user_id=${encodeURIComponent(orgUser.orgUserId)}; Path=/; Max-Age=${60 * 60 * 24}${isSecure ? '; Secure' : ''}; SameSite=Lax; HttpOnly`);
    }
    // Ensure email is registered in group DB so magic link lookup works
    await registerGroupMember(env, groupId, email, userId).catch(() => null);
  }
  if (magicEmail || magicGroupId) {
    headers.append('Set-Cookie', `magic_email=; Path=/; Max-Age=0`);
    headers.append('Set-Cookie', `magic_group_id=; Path=/; Max-Age=0`);
  }

  return new Response(JSON.stringify({ group_id: groupId }), { status: 200, headers });
}

export async function handleSelectOrg(request: Request, env: AuthorizeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/auth/select-org' || request.method !== 'GET') {
    return null;
  }

  const orgId = url.searchParams.get('group_id');
  if (!orgId) {
    return json({ error: 'group_id_required' }, { status: 400 });
  }

  const cookies = parseCookies(request);
  const identityUserId = cookies.get('identity_user_id');
  const isSecure = url.protocol === 'https:';
  const headers = new Headers();
  headers.set('Location', '/');
  headers.append('Set-Cookie', `identity_group_id=${encodeURIComponent(orgId)}; Path=/; Max-Age=${60 * 60 * 24}${isSecure ? '; Secure' : ''}; SameSite=Lax`);

  if (identityUserId) {
    const magicEmail = cookies.get('magic_email') ? decodeURIComponent(cookies.get('magic_email')!) : null;
    const [githubSession, googleSession] = await Promise.allSettled([
      readGitHubSession(request, env),
      readGoogleSession(request, env),
    ]);
    const email = magicEmail ??
      (githubSession.status === 'fulfilled' ? githubSession.value?.email : null) ??
      (googleSession.status === 'fulfilled' ? googleSession.value?.email : null);

    if (email) {
      const orgUser = await resolveOrgUser(env, orgId, identityUserId, email);
      if (orgUser) {
        headers.append('Set-Cookie', `org_user_id=${encodeURIComponent(orgUser.orgUserId)}; Path=/; Max-Age=${60 * 60 * 24}${isSecure ? '; Secure' : ''}; SameSite=Lax; HttpOnly`);
      }
      // Ensure email is registered in group DB so magic link lookup works
      await registerGroupMember(env, orgId, email, identityUserId).catch(() => null);
    }
    if (magicEmail) {
      headers.append('Set-Cookie', `magic_email=; Path=/; Max-Age=0`);
      headers.append('Set-Cookie', `magic_group_id=; Path=/; Max-Age=0`);
    }
  }

  return new Response(null, { status: 302, headers });
}

export async function handleOrgCreate(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/auth/organizations' || request.method !== 'POST') {
    return null;
  }

  const cookies = parseCookies(request);
  const userId = cookies.get('identity_user_id');
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

export async function handleOrgMembers(request: Request, env: AuthorizeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/auth/members')) return null;

  const cookies = parseCookies(request);
  const orgId = cookies.get('identity_org_id');
  const orgUserId = cookies.get('org_user_id');
  if (!orgId) {
    return json({ error: 'not_authenticated' }, { status: 401 });
  }

  const backendPath = url.pathname.replace('/api/auth/members', '/api/v1/graph/members') + url.search;
  const bodyText = request.body ? await request.text() : undefined;

  const res = await authorizeFetch(env, {
    path: backendPath,
    method: request.method,
    body: bodyText,
    tenantContext: { tenantId: orgId, subjectId: orgUserId ?? undefined },
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
  if (url.pathname !== '/api/auth/magic-link' || request.method !== 'POST') return null;

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
      return new Response(JSON.stringify({ error_code: 'turnstile_required' }), {
        status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    const valid = await verifyTurnstileToken(token, secretKey, request.headers.get('CF-Connecting-IP') ?? undefined);
    if (!valid) {
      return new Response(JSON.stringify({ error_code: 'turnstile_failed' }), {
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
  const longCookieOpts = `Path=/; Max-Age=${60 * 60 * 24}; SameSite=Lax${isSecure ? '; Secure' : ''}`;
  const headers = new Headers();

  try {
    if (result.purpose === 'group_create' && result.group_name) {
      // Create user + group, register email in group DB
      const userId = await createBareUser(env);
      const org = await createOrganization(env, userId, result.group_name);
      await registerGroupMember(env, org.id, result.email, userId);

      headers.append('Set-Cookie', `identity_user_id=${encodeURIComponent(userId)}; ${longCookieOpts}; HttpOnly`);
      headers.append('Set-Cookie', `magic_email=${encodeURIComponent(result.email)}; ${shortCookieOpts}`);
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

      headers.append('Set-Cookie', `identity_user_id=${encodeURIComponent(userId)}; ${longCookieOpts}; HttpOnly`);
      headers.append('Set-Cookie', `magic_email=${encodeURIComponent(result.email)}; ${shortCookieOpts}`);
      headers.append('Set-Cookie', `magic_group_id=${encodeURIComponent(result.group_id)}; ${shortCookieOpts}`);
      headers.set('Location', '/group-select');
      return new Response(null, { status: 302, headers });
    }
  } catch {
    return new Response(null, { status: 302, headers: { Location: '/login?error=invalid_magic_link' } });
  }

  // General login (no org context): set magic_email and return to login for OAuth
  headers.append('Set-Cookie', `magic_email=${encodeURIComponent(result.email)}; ${shortCookieOpts}`);
  headers.set('Location', '/login');
  return new Response(null, { status: 302, headers });
}

// GET /api/auth/member-check?group_id=xxx&email=yyy
// Pre-login check: is this email registered in the group? Returns { user_id } or 404.
export async function handleMemberCheck(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/auth/member-check' || request.method !== 'GET') return null;

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
