import { authorizeFetch, type AuthorizeEnv } from "./session";
import { issueSessionToken, readSessionToken } from "./session/token";
import { parseCookies, serializeCookie, clearCookie } from "./session/cookies";

// GitHub login session (read:user scope — identity only)
export type IdentifyGitHubSession = {
  authenticated: true;
  accessToken: string;
  viewer: {
    login: string;
    name: string | null;
  };
  email: string | null;
};

// GitHub connect session (repo and other resource scopes)
export type IdentifyGitHubConnectSession = {
  connected: true;
  accessToken: string;
  scopes: string;
};

// Google login session (openid email profile)
export type IdentifyGoogleSession = {
  authenticated: true;
  email: string;
  name: string | null;
  sub: string;
};

// Microsoft login session (OIDC — openid email profile)
export type IdentifyMicrosoftSession = {
  authenticated: true;
  email: string;
  name: string | null;
  sub: string;
};

const GITHUB_SESSION_COOKIE = "github_session";
const GITHUB_CONNECT_SESSION_COOKIE = "github_connect_session";
const GOOGLE_SESSION_COOKIE = "google_session";
const MICROSOFT_SESSION_COOKIE = "microsoft_session";
const SESSION_TTL = 60 * 10;

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
): Promise<IdentifyGitHubSession> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/github/oauth/callback",
    method: "POST",
    body: JSON.stringify({ code, redirectUri }),
  });
  if (!response.ok) {
    throw new Error(`identify_github_oauth_exchange_failed:${response.status}`);
  }
  return (await response.json()) as IdentifyGitHubSession;
}

export async function serializeGitHubSessionCookie(
  session: IdentifyGitHubSession,
  env: AuthorizeEnv,
  request: Request,
): Promise<string> {
  const token = await issueSessionToken(env, { ...session }, SESSION_TTL);
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
): Promise<IdentifyGoogleSession> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/google/oauth/callback",
    method: "POST",
    body: JSON.stringify({ code, redirectUri }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`identify_google_oauth_exchange_failed:${response.status}:${body}`);
  }
  return (await response.json()) as IdentifyGoogleSession;
}

export async function serializeGoogleSessionCookie(
  session: IdentifyGoogleSession,
  env: AuthorizeEnv,
  request: Request,
): Promise<string> {
  const token = await issueSessionToken(env, { ...session }, SESSION_TTL);
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
  email: string,
): Promise<OrgUser | null> {
  try {
    const res = await authorizeFetch(env, {
      path: "/api/v1/identify/org-user",
      method: "POST",
      body: JSON.stringify({ orgId, identityUserId, email }),
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
  const data = (await res.json()) as { organizations: IdentityOrg[] };
  return data.organizations;
}

export async function createOrganization(env: AuthorizeEnv, userId: string, name: string): Promise<IdentityOrg> {
  const res = await authorizeFetch(env, {
    path: "/api/v1/identity/organizations",
    method: "POST",
    body: JSON.stringify({ user_id: userId, name }),
  });
  if (!res.ok) throw new Error(`identity_create_org_failed:${res.status}`);
  return (await res.json()) as IdentityOrg;
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
  const res = await authorizeFetch(env, {
    path: `/api/v1/identity/groups/${encodeURIComponent(groupId)}`,
    method: "GET",
  });
  if (!res.ok) return null;
  return (await res.json()) as { id: string; name: string };
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

// ---- Microsoft login ----

export function buildMicrosoftLoginUrl(env: Pick<AuthorizeEnv, "FRONTEND_ORIGIN">): string {
  return new URL("/oauth/microsoft/start", env.FRONTEND_ORIGIN ?? "http://localhost:8787").toString();
}

export async function exchangeMicrosoftOAuthCode(
  env: AuthorizeEnv,
  code: string,
  redirectUri: string,
): Promise<IdentifyMicrosoftSession> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/microsoft/oauth/callback",
    method: "POST",
    body: JSON.stringify({ code, redirectUri }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`identify_microsoft_oauth_exchange_failed:${response.status}:${body}`);
  }
  return (await response.json()) as IdentifyMicrosoftSession;
}

export async function serializeMicrosoftSessionCookie(
  session: IdentifyMicrosoftSession,
  env: AuthorizeEnv,
  request: Request,
): Promise<string> {
  const token = await issueSessionToken(env, { ...session }, SESSION_TTL);
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
