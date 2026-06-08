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

const GITHUB_SESSION_COOKIE = "github_session";
const GITHUB_CONNECT_SESSION_COOKIE = "github_connect_session";
const GOOGLE_SESSION_COOKIE = "google_session";
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

async function findUserByEmail(env: AuthorizeEnv, email: string): Promise<string | null> {
  const res = await authorizeFetch(env, {
    path: `/api/v1/identity/users/by-email/${encodeURIComponent(email.toLowerCase())}`,
    method: "GET",
  });
  if (res.ok) return ((await res.json()) as { user_id: string }).user_id;
  return null;
}

async function linkEmailToUser(env: AuthorizeEnv, userId: string, email: string): Promise<void> {
  await authorizeFetch(env, {
    path: `/api/v1/identity/users/${encodeURIComponent(userId)}/link-email`,
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

async function linkGitHubToUser(env: AuthorizeEnv, userId: string, githubId: string): Promise<void> {
  await authorizeFetch(env, {
    path: `/api/v1/identity/users/${encodeURIComponent(userId)}/link-github`,
    method: "POST",
    body: JSON.stringify({ github_id: githubId }),
  });
}

async function linkGoogleToUser(env: AuthorizeEnv, userId: string, googleSub: string): Promise<void> {
  await authorizeFetch(env, {
    path: `/api/v1/identity/users/${encodeURIComponent(userId)}/link-google`,
    method: "POST",
    body: JSON.stringify({ google_id: googleSub }),
  });
}

export async function findOrCreateUserByGitHub(
  env: AuthorizeEnv,
  githubId: string,
  email?: string | null,
): Promise<string> {
  const findRes = await authorizeFetch(env, {
    path: `/api/v1/identity/users/by-github/${encodeURIComponent(githubId)}`,
    method: "GET",
  });
  if (findRes.ok) {
    const userId = ((await findRes.json()) as IdentityUser).user_id;
    if (email) await linkEmailToUser(env, userId, email).catch(() => null);
    return userId;
  }
  if (findRes.status !== 404) throw new Error(`identity_find_github_failed:${findRes.status}`);

  if (email) {
    try {
      const userId = await findUserByEmail(env, email);
      if (userId) {
        await linkGitHubToUser(env, userId, githubId);
        await linkEmailToUser(env, userId, email).catch(() => null);
        return userId;
      }
    } catch { /* non-fatal */ }
  }

  const createRes = await authorizeFetch(env, {
    path: "/api/v1/identity/users",
    method: "POST",
    body: JSON.stringify({ github_id: githubId }),
  });
  if (!createRes.ok) throw new Error(`identity_create_user_failed:${createRes.status}`);
  const userId = ((await createRes.json()) as IdentityUser).user_id;
  if (email) await linkEmailToUser(env, userId, email).catch(() => null);
  return userId;
}

export async function findOrCreateUserByGoogle(
  env: AuthorizeEnv,
  googleSub: string,
  email?: string,
): Promise<string> {
  const findRes = await authorizeFetch(env, {
    path: `/api/v1/identity/users/by-google/${encodeURIComponent(googleSub)}`,
    method: "GET",
  });
  if (findRes.ok) {
    const userId = ((await findRes.json()) as IdentityUser).user_id;
    if (email) await linkEmailToUser(env, userId, email).catch(() => null);
    return userId;
  }
  if (findRes.status !== 404) throw new Error(`identity_find_google_failed:${findRes.status}`);

  if (email) {
    try {
      const userId = await findUserByEmail(env, email);
      if (userId) {
        await linkGoogleToUser(env, userId, googleSub);
        await linkEmailToUser(env, userId, email).catch(() => null);
        return userId;
      }
    } catch { /* non-fatal */ }
  }

  const createRes = await authorizeFetch(env, {
    path: "/api/v1/identity/users",
    method: "POST",
    body: JSON.stringify({ google_id: googleSub }),
  });
  if (!createRes.ok) throw new Error(`identity_create_user_failed:${createRes.status}`);
  const userId = ((await createRes.json()) as IdentityUser).user_id;
  if (email) await linkEmailToUser(env, userId, email).catch(() => null);
  return userId;
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
