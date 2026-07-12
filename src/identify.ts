import { authorizeFetch, type AuthorizeEnv } from "./session";
import { issueSessionToken, readSessionToken } from "./session/token";
import { parseCookies, serializeCookie, clearCookie } from "./session/cookies";

// GitHub login session (read:user scope — identity only).
// STORED in the cookie: no PII (no email, no display name). email/name are only used
// in-process at the OAuth callback (see IdentifyGitHubExchange) and never persisted here.
export type IdentifyGitHubSession = {
  authenticated: true;
  accessToken: string;
  viewer: {
    login: string;
  };
};

// What the callback receives from the code exchange — includes PII (email) used once, in
// process, to land the email in the group DB. Never written to the session cookie.
export type IdentifyGitHubExchange = IdentifyGitHubSession & { email: string | null };

// GitHub connect session (repo and other resource scopes)
export type IdentifyGitHubConnectSession = {
  connected: true;
  accessToken: string;
  scopes: string;
};

// Google login session. STORED in the cookie: no PII (only the authenticated flag). email/sub
// are used in-process at the callback (IdentifyGoogleExchange) and never persisted here.
export type IdentifyGoogleSession = {
  authenticated: true;
};

export type IdentifyGoogleExchange = IdentifyGoogleSession & { email: string; name: string | null; sub: string };

// Microsoft login session. STORED in the cookie: no PII (only the authenticated flag). email/sub
// are used in-process at the callback (IdentifyMicrosoftExchange) and never persisted here.
export type IdentifyMicrosoftSession = {
  authenticated: true;
};

export type IdentifyMicrosoftExchange = IdentifyMicrosoftSession & { email: string; name: string | null; sub: string };

const GITHUB_SESSION_COOKIE = "__Host-github_session";
const GITHUB_CONNECT_SESSION_COOKIE = "__Host-github_connect_session";
const GOOGLE_SESSION_COOKIE = "__Host-google_session";
const MICROSOFT_SESSION_COOKIE = "__Host-microsoft_session";
const SESSION_TTL = 60 * 60 * 24 * 7;

// ---- GitHub login ----

export function buildGitHubLoginUrl(env: Pick<AuthorizeEnv, "FRONTEND_ORIGIN">): string {
  return new URL("/oauth/github/start", env.FRONTEND_ORIGIN ?? "http://localhost:8787").toString();
}

/** @deprecated Use buildGitHubLoginUrl */
export function buildGitHubOAuthStartUrl(env: Pick<AuthorizeEnv, "FRONTEND_ORIGIN">, scope = "read:user"): string {
  const url = new URL("/oauth/github/start", env.FRONTEND_ORIGIN ?? "http://localhost:8787");
  if (scope) url.searchParams.set("scope", scope);
  return url.toString();
}

export async function exchangeGitHubOAuthCode(
  env: AuthorizeEnv,
  code: string,
  redirectUri: string,
): Promise<IdentifyGitHubExchange> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/github/oauth/callback",
    method: "POST",
    body: JSON.stringify({ code, redirectUri }),
  });
  if (!response.ok) {
    throw new Error(`identify_github_oauth_exchange_failed:${response.status}`);
  }
  return (await response.json()) as IdentifyGitHubExchange;
}

export async function serializeGitHubSessionCookie(
  session: IdentifyGitHubSession,
  env: AuthorizeEnv,
  request: Request,
): Promise<string> {
  // Allowlist non-PII fields explicitly — never spread the exchange object (it may carry email).
  const token = await issueSessionToken(
    env,
    { authenticated: session.authenticated, accessToken: session.accessToken, viewer: { login: session.viewer.login } },
    SESSION_TTL,
  );
  return serializeCookie(GITHUB_SESSION_COOKIE, token, {
    maxAge: SESSION_TTL,
    path: "/",
    secure: new URL(request.url).protocol === "https:",
    httpOnly: true,
    sameSite: "Lax",
  });
}

export async function readGitHubSession(
  request: Request | null,
  env: AuthorizeEnv,
): Promise<IdentifyGitHubSession | null> {
  if (!request) return null;
  const cookies = parseCookies(request);
  const token = cookies.get(GITHUB_SESSION_COOKIE);
  if (!token) return null;
  const data = await readSessionToken<IdentifyGitHubSession>(env, token);
  return data?.authenticated ? data : null;
}

export function clearGitHubSessionCookies(request: Request): string[] {
  return [clearCookie(GITHUB_SESSION_COOKIE, request)];
}

/** @deprecated Call clearGitHubSessionCookies and set headers in the response instead */
export async function logoutGitHub(_env: AuthorizeEnv): Promise<void> {}

// ---- GitHub connect (resource access) ----

export function buildGitHubConnectUrl(env: Pick<AuthorizeEnv, "FRONTEND_ORIGIN">, scope = "repo read:user"): string {
  const url = new URL("/oauth/github/connect/start", env.FRONTEND_ORIGIN ?? "http://localhost:8787");
  if (scope) url.searchParams.set("scope", scope);
  return url.toString();
}

export async function exchangeGitHubConnectCode(
  env: AuthorizeEnv,
  code: string,
  redirectUri: string,
): Promise<IdentifyGitHubConnectSession> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/github-connect/oauth/callback",
    method: "POST",
    body: JSON.stringify({ code, redirectUri }),
  });
  if (!response.ok) {
    throw new Error(`identify_github_connect_exchange_failed:${response.status}`);
  }
  return (await response.json()) as IdentifyGitHubConnectSession;
}

export async function serializeGitHubConnectSessionCookie(
  session: IdentifyGitHubConnectSession,
  env: AuthorizeEnv,
  request: Request,
): Promise<string> {
  const token = await issueSessionToken(env, { ...session }, SESSION_TTL);
  return serializeCookie(GITHUB_CONNECT_SESSION_COOKIE, token, {
    maxAge: SESSION_TTL,
    path: "/",
    secure: new URL(request.url).protocol === "https:",
    httpOnly: true,
    sameSite: "Lax",
  });
}

export async function readGitHubConnectSession(
  request: Request | null,
  env: AuthorizeEnv,
): Promise<IdentifyGitHubConnectSession | null> {
  if (!request) return null;
  const cookies = parseCookies(request);
  const token = cookies.get(GITHUB_CONNECT_SESSION_COOKIE);
  if (!token) return null;
  const data = await readSessionToken<IdentifyGitHubConnectSession>(env, token);
  return data?.connected ? data : null;
}

export function clearGitHubConnectSessionCookies(request: Request): string[] {
  return [clearCookie(GITHUB_CONNECT_SESSION_COOKIE, request)];
}

/** @deprecated Call clearGitHubConnectSessionCookies instead */
export async function disconnectGitHub(_env: AuthorizeEnv): Promise<void> {}

// ---- Google login ----

export function buildGoogleLoginUrl(env: Pick<AuthorizeEnv, "FRONTEND_ORIGIN">): string {
  return new URL("/oauth/google/start", env.FRONTEND_ORIGIN ?? "http://localhost:8787").toString();
}

export async function exchangeGoogleOAuthCode(
  env: AuthorizeEnv,
  code: string,
  redirectUri: string,
): Promise<IdentifyGoogleExchange> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/google/oauth/callback",
    method: "POST",
    body: JSON.stringify({ code, redirectUri }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`identify_google_oauth_exchange_failed:${response.status}:${body}`);
  }
  return (await response.json()) as IdentifyGoogleExchange;
}

export async function serializeGoogleSessionCookie(
  session: IdentifyGoogleSession,
  env: AuthorizeEnv,
  request: Request,
): Promise<string> {
  // Allowlist non-PII fields explicitly — never spread the exchange object (it carries email).
  const token = await issueSessionToken(env, { authenticated: session.authenticated }, SESSION_TTL);
  return serializeCookie(GOOGLE_SESSION_COOKIE, token, {
    maxAge: SESSION_TTL,
    path: "/",
    secure: new URL(request.url).protocol === "https:",
    httpOnly: true,
    sameSite: "Lax",
  });
}

export async function readGoogleSession(
  request: Request | null,
  env: AuthorizeEnv,
): Promise<IdentifyGoogleSession | null> {
  if (!request) return null;
  const cookies = parseCookies(request);
  const token = cookies.get(GOOGLE_SESSION_COOKIE);
  if (!token) return null;
  const data = await readSessionToken<IdentifyGoogleSession>(env, token);
  return data?.authenticated ? data : null;
}

export function clearGoogleSessionCookies(request: Request): string[] {
  return [clearCookie(GOOGLE_SESSION_COOKIE, request)];
}

/** @deprecated Call clearGoogleSessionCookies instead */
export async function logoutGoogle(_env: AuthorizeEnv): Promise<void> {}

// ---- Identity (user / org management) ----

export type IdentityUser = {
  user_id: string;
  github_user_id?: string;
  google_user_id?: string;
};

export type IdentityOrg = {
  id: string;
  name: string;
};

export async function linkGitHubToUser(env: AuthorizeEnv, userId: string, githubId: string): Promise<void> {
  await authorizeFetch(env, {
    path: `/api/v1/identity/users/${encodeURIComponent(userId)}/link-github`,
    method: "POST",
    body: JSON.stringify({ github_id: githubId }),
  });
}

export async function linkGoogleToUser(env: AuthorizeEnv, userId: string, googleSub: string): Promise<void> {
  await authorizeFetch(env, {
    path: `/api/v1/identity/users/${encodeURIComponent(userId)}/link-google`,
    method: "POST",
    body: JSON.stringify({ google_id: googleSub }),
  });
}

export async function findOrCreateUserByGitHub(
  env: AuthorizeEnv,
  githubId: string,
): Promise<string> {
  const findRes = await authorizeFetch(env, {
    path: `/api/v1/identity/users/by-github/${encodeURIComponent(githubId)}`,
    method: "GET",
  });
  if (findRes.ok) return ((await findRes.json()) as IdentityUser).user_id;
  if (findRes.status !== 404) throw new Error(`identity_find_github_failed:${findRes.status}`);

  const createRes = await authorizeFetch(env, {
    path: "/api/v1/identity/users",
    method: "POST",
    body: JSON.stringify({ github_id: githubId }),
  });
  if (!createRes.ok) throw new Error(`identity_create_user_failed:${createRes.status}`);
  return ((await createRes.json()) as IdentityUser).user_id;
}

export async function findOrCreateUserByGoogle(
  env: AuthorizeEnv,
  googleSub: string,
): Promise<string> {
  const findRes = await authorizeFetch(env, {
    path: `/api/v1/identity/users/by-google/${encodeURIComponent(googleSub)}`,
    method: "GET",
  });
  if (findRes.ok) return ((await findRes.json()) as IdentityUser).user_id;
  if (findRes.status !== 404) throw new Error(`identity_find_google_failed:${findRes.status}`);

  const createRes = await authorizeFetch(env, {
    path: "/api/v1/identity/users",
    method: "POST",
    body: JSON.stringify({ google_id: googleSub }),
  });
  if (!createRes.ok) throw new Error(`identity_create_user_failed:${createRes.status}`);
  return ((await createRes.json()) as IdentityUser).user_id;
}

export type OrgUser = {
  orgUserId: string;
  created: boolean;
};

export async function resolveOrgUser(
  env: AuthorizeEnv,
  orgId: string,
  identityUserId: string,
): Promise<OrgUser | null> {
  try {
    // org_user_id is deterministically derived from (orgId, identityUserId) — no email is sent or
    // used for identification.
    const res = await authorizeFetch(env, {
      path: "/api/v1/identify/org-user",
      method: "POST",
      body: JSON.stringify({ orgId, identityUserId }),
    });
    if (!res.ok) return null;
    return (await res.json()) as OrgUser;
  } catch {
    return null;
  }
}

export async function listUserOrganizations(env: AuthorizeEnv, userId: string): Promise<IdentityOrg[]> {
  const res = await authorizeFetch(env, {
    path: `/api/v1/identity/organizations?user_id=${encodeURIComponent(userId)}`,
    method: "GET",
  });
  if (!res.ok) throw new Error(`identity_list_orgs_failed:${res.status}`);
  const data = (await res.json()) as { organizations: { id: string; name?: string }[] };
  // Phase2: グループ名は group DB を正とする。認証DBからは id のみを使い、名前は各 group DB から解決
  // （旧グループは遅延移行）。認証DB由来の name は移行期間の最終フォールバックに残す。
  return Promise.all(
    data.organizations.map(async (o) => ({
      id: o.id,
      name: (await resolveGroupName(env, o.id)) ?? o.name ?? o.id,
    })),
  );
}

export async function createOrganization(env: AuthorizeEnv, userId: string, name: string): Promise<IdentityOrg> {
  const res = await authorizeFetch(env, {
    path: "/api/v1/identity/organizations",
    method: "POST",
    body: JSON.stringify({ user_id: userId, name }),
  });
  if (!res.ok) throw new Error(`identity_create_org_failed:${res.status}`);
  const org = (await res.json()) as IdentityOrg;
  // Phase2: グループ名は group DB を正の置き場所とする（PII 混入しうるため認証DBに置かない）。
  // expand 期間は認証DB（createOrganization 内）と group DB の二重書き。読みは後で group DB へ切替。
  await setGroupName(env, org.id, name).catch(() => null);
  return org;
}

// グループ名を group DB から読む（Phase2 の正の置き場所）。
export async function getGroupName(env: AuthorizeEnv, groupId: string): Promise<string | null> {
  const res = await authorizeFetch(env, {
    path: `/api/v1/graph/group-name?group_id=${encodeURIComponent(groupId)}`,
    method: "GET",
    tenantContext: { tenantId: groupId },
  });
  if (!res.ok) return null;
  return ((await res.json()) as { name: string | null }).name;
}

// グループ名を group DB に設定/リネームする。
export async function setGroupName(env: AuthorizeEnv, groupId: string, name: string): Promise<void> {
  await authorizeFetch(env, {
    path: "/api/v1/graph/group-name",
    method: "PUT",
    body: JSON.stringify({ group_id: groupId, name }),
    tenantContext: { tenantId: groupId },
  });
}

// 認証DBの旧グループ名（移行元。Phase2 の contract で撤去予定）。
async function fetchLegacyGroupName(env: AuthorizeEnv, groupId: string): Promise<string | null> {
  const res = await authorizeFetch(env, {
    path: `/api/v1/identity/groups/${encodeURIComponent(groupId)}`,
    method: "GET",
  });
  if (!res.ok) return null;
  return ((await res.json()) as { id: string; name: string | null }).name ?? null;
}

// グループ名の解決: group DB を正とし、まだ無い既存グループは認証DBから読んで group DB へ遅延移行する
// （読まれた分だけ自己修復。全件掃きは 2b の backfill、認証DB名の撤去は 2d の contract）。
export async function resolveGroupName(env: AuthorizeEnv, groupId: string): Promise<string | null> {
  let name = await getGroupName(env, groupId);
  if (name == null) {
    const legacy = await fetchLegacyGroupName(env, groupId);
    if (legacy) {
      await setGroupName(env, groupId, legacy).catch(() => null);
      name = legacy;
    }
  }
  return name;
}

export async function searchOrganizationsByName(env: AuthorizeEnv, name: string): Promise<{ id: string }[]> {
  const res = await authorizeFetch(env, {
    path: `/api/v1/identity/organizations/search?name=${encodeURIComponent(name)}`,
    method: "GET",
  });
  if (!res.ok) return [];
  return ((await res.json()) as { organizations: { id: string }[] }).organizations;
}

export async function verifyMagicLinkToken(
  env: AuthorizeEnv,
  token: string,
): Promise<{ email: string; purpose: string; group_id: string | null; group_name: string | null } | null> {
  const res = await authorizeFetch(env, {
    path: `/api/v1/identity/magic-link/${encodeURIComponent(token)}`,
    method: "GET",
  });
  if (!res.ok) return null;
  return (await res.json()) as { email: string; purpose: string; group_id: string | null; group_name: string | null };
}

export async function fetchGroupInfo(env: AuthorizeEnv, groupId: string): Promise<{ id: string; name: string } | null> {
  // Phase2: 名前は group DB を正とする（旧グループは遅延移行）。
  const name = await resolveGroupName(env, groupId);
  return { id: groupId, name: name ?? groupId };
}

export async function createBareUser(env: AuthorizeEnv): Promise<string> {
  const res = await authorizeFetch(env, {
    path: "/api/v1/identity/users/bare",
    method: "POST",
    body: "{}",
  });
  if (!res.ok) throw new Error(`identity_create_bare_user_failed:${res.status}`);
  return ((await res.json()) as { user_id: string }).user_id;
}

export async function findMemberByEmail(
  env: AuthorizeEnv,
  groupId: string,
  email: string,
): Promise<string | null> {
  const res = await authorizeFetch(env, {
    path: `/api/v1/graph/members/by-email?email=${encodeURIComponent(email)}`,
    method: "GET",
    tenantContext: { tenantId: groupId },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`find_member_by_email_failed:${res.status}`);
  return ((await res.json()) as { user_id: string }).user_id;
}

export async function registerGroupMember(
  env: AuthorizeEnv,
  groupId: string,
  email: string,
  userId: string,
): Promise<void> {
  const res = await authorizeFetch(env, {
    path: "/api/v1/graph/members",
    method: "POST",
    body: JSON.stringify({ email, userId }),
    tenantContext: { tenantId: groupId },
  });
  if (!res.ok) throw new Error(`register_group_member_failed:${res.status}`);
}

export async function getDefaultGroup(env: AuthorizeEnv, userId: string): Promise<string | null> {
  const res = await authorizeFetch(env, {
    path: `/api/v1/identity/users/${encodeURIComponent(userId)}/default-group`,
    method: "GET",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { group_id: string | null };
  return data.group_id;
}

export async function setDefaultGroup(env: AuthorizeEnv, userId: string, groupId: string): Promise<void> {
  await authorizeFetch(env, {
    path: `/api/v1/identity/users/${encodeURIComponent(userId)}/default-group`,
    method: "PUT",
    body: JSON.stringify({ group_id: groupId }),
  });
}

// 既定グループ名（汎用・非PII）。個人名など自由入力の PII は認証DBに載せないため、初回自動作成は
// この汎用名で作り、あとでユーザーがリネームする（リネームは group DB 側で持つ — Phase 2）。
const DEFAULT_GROUP_NAME = "マイグループ";

// メンバーの email を group DB（P2 の唯一の正規の置き場所 — cookie にも全体共通の認証DBにも置かない）に
// 登録する。email が正当に手元にある OAuth callback の瞬間に呼ぶ。まだグループを持たない新規ユーザーには
// 汎用名で既定グループを自動作成する（＝アカウント作成と同時にグループが出る）。非致命的（失敗してもログインは通す）。
export async function registerLoginEmailToGroup(
  env: AuthorizeEnv,
  userId: string,
  email: string | null,
): Promise<void> {
  if (!email) return;
  try {
    let groupId = await getDefaultGroup(env, userId);
    if (!groupId) {
      const org = await createOrganization(env, userId, DEFAULT_GROUP_NAME);
      groupId = org.id;
    }
    await registerGroupMember(env, groupId, email, userId);
  } catch {
    // 登録失敗はログインをブロックしない（magic-link 復旧用マッピングは次回ログインで補完される）。
  }
}

// ---- Microsoft login ----

export function buildMicrosoftLoginUrl(env: Pick<AuthorizeEnv, "FRONTEND_ORIGIN">): string {
  return new URL("/oauth/microsoft/start", env.FRONTEND_ORIGIN ?? "http://localhost:8787").toString();
}

export async function exchangeMicrosoftOAuthCode(
  env: AuthorizeEnv,
  code: string,
  redirectUri: string,
): Promise<IdentifyMicrosoftExchange> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/microsoft/oauth/callback",
    method: "POST",
    body: JSON.stringify({ code, redirectUri }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`identify_microsoft_oauth_exchange_failed:${response.status}:${body}`);
  }
  return (await response.json()) as IdentifyMicrosoftExchange;
}

export async function serializeMicrosoftSessionCookie(
  session: IdentifyMicrosoftSession,
  env: AuthorizeEnv,
  request: Request,
): Promise<string> {
  // Allowlist non-PII fields explicitly — never spread the exchange object (it carries email).
  const token = await issueSessionToken(env, { authenticated: session.authenticated }, SESSION_TTL);
  return serializeCookie(MICROSOFT_SESSION_COOKIE, token, {
    maxAge: SESSION_TTL,
    path: "/",
    secure: new URL(request.url).protocol === "https:",
    httpOnly: true,
    sameSite: "Lax",
  });
}

export async function readMicrosoftSession(
  request: Request | null,
  env: AuthorizeEnv,
): Promise<IdentifyMicrosoftSession | null> {
  if (!request) return null;
  const cookies = parseCookies(request);
  const token = cookies.get(MICROSOFT_SESSION_COOKIE);
  if (!token) return null;
  const data = await readSessionToken<IdentifyMicrosoftSession>(env, token);
  return data?.authenticated ? data : null;
}

export function clearMicrosoftSessionCookies(request: Request): string[] {
  return [clearCookie(MICROSOFT_SESSION_COOKIE, request)];
}

export async function linkMicrosoftToUser(env: AuthorizeEnv, userId: string, microsoftSub: string): Promise<void> {
  await authorizeFetch(env, {
    path: `/api/v1/identity/users/${encodeURIComponent(userId)}/link-microsoft`,
    method: "POST",
    body: JSON.stringify({ microsoft_id: microsoftSub }),
  });
}

export async function findOrCreateUserByMicrosoft(
  env: AuthorizeEnv,
  microsoftSub: string,
): Promise<string> {
  const findRes = await authorizeFetch(env, {
    path: `/api/v1/identity/users/by-microsoft/${encodeURIComponent(microsoftSub)}`,
    method: "GET",
  });
  if (findRes.ok) return ((await findRes.json()) as IdentityUser).user_id;
  if (findRes.status !== 404) throw new Error(`identity_find_microsoft_failed:${findRes.status}`);

  const createRes = await authorizeFetch(env, {
    path: "/api/v1/identity/users",
    method: "POST",
    body: JSON.stringify({ microsoft_id: microsoftSub }),
  });
  if (!createRes.ok) throw new Error(`identity_create_user_failed:${createRes.status}`);
  return ((await createRes.json()) as IdentityUser).user_id;
}

// ---- OIDC login ----

// OIDC login session. STORED in the cookie: no PII (only the authenticated flag). oidcId/sub/email
// are used in-process at the callback (IdentifyOidcExchange) and never persisted here.
export type IdentifyOidcSession = {
  authenticated: true;
};

export type IdentifyOidcExchange = IdentifyOidcSession & {
  oidcId: string;
  sub: string;
  email: string | null;
  name: string | null;
};

const OIDC_SESSION_COOKIE = "__Host-oidc_session";

export async function exchangeOidcOAuthCode(
  env: AuthorizeEnv,
  oidcId: string,
  code: string,
  redirectUri: string,
): Promise<IdentifyOidcExchange> {
  // First fetch provider config
  const configRes = await authorizeFetch(env, {
    path: `/api/v1/identity/oidc/${encodeURIComponent(oidcId)}`,
    method: "GET",
  });
  if (!configRes.ok) throw new Error(`oidc_provider_not_found:${oidcId}`);
  const config = (await configRes.json()) as { issuer: string; app_id: string; app_secret: string };

  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/oidc/callback",
    method: "POST",
    body: JSON.stringify({
      oidcId,
      issuer: config.issuer,
      appId: config.app_id,
      appSecret: config.app_secret,
      code,
      redirectUri,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`identify_oidc_exchange_failed:${response.status}:${body}`);
  }
  return (await response.json()) as IdentifyOidcExchange;
}

export async function serializeOidcSessionCookie(
  session: IdentifyOidcSession,
  env: AuthorizeEnv,
  request: Request,
): Promise<string> {
  // Allowlist non-PII fields explicitly — never spread the exchange object (it carries email).
  const token = await issueSessionToken(env, { authenticated: session.authenticated }, SESSION_TTL);
  return serializeCookie(OIDC_SESSION_COOKIE, token, {
    maxAge: SESSION_TTL,
    path: "/",
    secure: new URL(request.url).protocol === "https:",
    httpOnly: true,
    sameSite: "Lax",
  });
}

export async function readOidcSession(
  request: Request | null,
  env: AuthorizeEnv,
): Promise<IdentifyOidcSession | null> {
  if (!request) return null;
  const cookies = parseCookies(request);
  const token = cookies.get(OIDC_SESSION_COOKIE);
  if (!token) return null;
  const data = await readSessionToken<IdentifyOidcSession>(env, token);
  return data?.authenticated ? data : null;
}

export function clearOidcSessionCookies(request: Request): string[] {
  return [clearCookie(OIDC_SESSION_COOKIE, request)];
}

export async function findOrCreateUserByOidc(
  env: AuthorizeEnv,
  oidcId: string,
  sub: string,
): Promise<string> {
  const findRes = await authorizeFetch(env, {
    path: `/api/v1/identity/users/by-oidc?oidc_id=${encodeURIComponent(oidcId)}&sub=${encodeURIComponent(sub)}`,
    method: "GET",
  });
  if (findRes.ok) return ((await findRes.json()) as { user_id: string }).user_id;
  if (findRes.status !== 404) throw new Error(`identity_find_oidc_failed:${findRes.status}`);

  const createRes = await authorizeFetch(env, {
    path: "/api/v1/identity/users",
    method: "POST",
    body: JSON.stringify({ oidc_id: oidcId, oidc_sub: sub }),
  });
  if (!createRes.ok) throw new Error(`identity_create_oidc_user_failed:${createRes.status}`);
  return ((await createRes.json()) as { user_id: string }).user_id;
}
