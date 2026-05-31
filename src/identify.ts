import { authorizeFetch, type AuthorizeEnv } from "./auth";

// GitHub login session (read:user scope — identity only)
export type IdentifyGitHubSession = {
  authenticated: true;
  accessToken: string;
  viewer: {
    login: string;
    name: string | null;
  };
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

// ---- GitHub login ----

export function buildGitHubLoginUrl(
  env: Pick<AuthorizeEnv, "FRONTEND_ORIGIN">,
): string {
  const base = env.FRONTEND_ORIGIN ?? "http://localhost:8787";
  return new URL("/oauth/github/start", base).toString();
}

/** @deprecated Use buildGitHubLoginUrl for login or buildGitHubConnectUrl for resource access */
export function buildGitHubOAuthStartUrl(
  env: Pick<AuthorizeEnv, "FRONTEND_ORIGIN">,
  scope = "read:user",
): string {
  const base = env.FRONTEND_ORIGIN ?? "http://localhost:8787";
  const url = new URL("/oauth/github/start", base);
  if (scope) {
    url.searchParams.set("scope", scope);
  }
  return url.toString();
}

export async function readGitHubSession(
  env: AuthorizeEnv,
): Promise<IdentifyGitHubSession | null> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/github",
    method: "GET",
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`identify_session_lookup_failed:${response.status}`);
  }

  const payload = (await response.json()) as IdentifyGitHubSession;
  return payload.authenticated ? payload : null;
}

export async function exchangeGitHubOAuthCode(
  env: AuthorizeEnv,
  code: string,
  redirectUri: string,
): Promise<void> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/github/oauth/callback",
    method: "POST",
    body: JSON.stringify({ code, redirectUri }),
  });

  if (!response.ok) {
    throw new Error(`identify_github_oauth_exchange_failed:${response.status}`);
  }
}

export async function logoutGitHub(env: AuthorizeEnv): Promise<void> {
  await authorizeFetch(env, {
    path: "/api/v1/identify/session/github/logout",
    method: "POST",
  });
}

// ---- GitHub connect (resource access) ----

export function buildGitHubConnectUrl(
  env: Pick<AuthorizeEnv, "FRONTEND_ORIGIN">,
  scope = "repo read:user",
): string {
  const base = env.FRONTEND_ORIGIN ?? "http://localhost:8787";
  const url = new URL("/oauth/github/connect/start", base);
  if (scope) {
    url.searchParams.set("scope", scope);
  }
  return url.toString();
}

export async function readGitHubConnectSession(
  env: AuthorizeEnv,
): Promise<IdentifyGitHubConnectSession | null> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/github-connect",
    method: "GET",
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`identify_github_connect_session_lookup_failed:${response.status}`);
  }

  const payload = (await response.json()) as IdentifyGitHubConnectSession;
  return payload.connected ? payload : null;
}

export async function exchangeGitHubConnectCode(
  env: AuthorizeEnv,
  code: string,
  redirectUri: string,
): Promise<void> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/github-connect/oauth/callback",
    method: "POST",
    body: JSON.stringify({ code, redirectUri }),
  });

  if (!response.ok) {
    throw new Error(`identify_github_connect_exchange_failed:${response.status}`);
  }
}

export async function disconnectGitHub(env: AuthorizeEnv): Promise<void> {
  await authorizeFetch(env, {
    path: "/api/v1/identify/session/github-connect/disconnect",
    method: "POST",
  });
}

// ---- Google login ----

export function buildGoogleLoginUrl(
  env: Pick<AuthorizeEnv, "FRONTEND_ORIGIN">,
): string {
  const base = env.FRONTEND_ORIGIN ?? "http://localhost:8787";
  return new URL("/oauth/google/start", base).toString();
}

export async function readGoogleSession(
  env: AuthorizeEnv,
): Promise<IdentifyGoogleSession | null> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/google",
    method: "GET",
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`identify_google_session_lookup_failed:${response.status}`);
  }

  const payload = (await response.json()) as IdentifyGoogleSession;
  return payload.authenticated ? payload : null;
}

export async function exchangeGoogleOAuthCode(
  env: AuthorizeEnv,
  code: string,
  redirectUri: string,
): Promise<void> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/identify/session/google/oauth/callback",
    method: "POST",
    body: JSON.stringify({ code, redirectUri }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`identify_google_oauth_exchange_failed:${response.status}:${body}`);
  }
}

export async function logoutGoogle(env: AuthorizeEnv): Promise<void> {
  await authorizeFetch(env, {
    path: "/api/v1/identify/session/google/logout",
    method: "POST",
  });
}

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

async function fetchGitHubVerifiedEmail(env: AuthorizeEnv, accessToken: string): Promise<string | null> {
  const res = await authorizeFetch(env, {
    path: "/api/v1/github/user/emails",
    method: "GET",
    headers: { "x-github-access-token": accessToken },
  });
  if (!res.ok) return null;
  const emails = (await res.json()) as Array<{ email: string; verified: boolean; primary: boolean }>;
  const primary = emails.find((e) => e.primary && e.verified);
  return primary?.email.toLowerCase() ?? null;
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
  accessToken?: string,
): Promise<string> {
  // 1. Find by GitHub ID
  const findRes = await authorizeFetch(env, {
    path: `/api/v1/identity/users/by-github/${encodeURIComponent(githubId)}`,
    method: "GET",
  });
  if (findRes.ok) {
    const userId = ((await findRes.json()) as IdentityUser).user_id;
    // Store email even if user already exists (idempotent)
    if (accessToken) {
      const email = await fetchGitHubVerifiedEmail(env, accessToken).catch(() => null);
      if (email) await linkEmailToUser(env, userId, email).catch(() => null);
    }
    return userId;
  }
  if (findRes.status !== 404) {
    throw new Error(`identity_find_github_failed:${findRes.status}`);
  }

  // 2. Try email-based linking (GitHub verified email)
  if (accessToken) {
    try {
      const email = await fetchGitHubVerifiedEmail(env, accessToken);
      if (email) {
        const userId = await findUserByEmail(env, email);
        if (userId) {
          await linkGitHubToUser(env, userId, githubId);
          await linkEmailToUser(env, userId, email).catch(() => null);
          return userId;
        }
      }
    } catch {
      // non-fatal
    }
  }

  // 3. Create new user with GitHub identity
  const createRes = await authorizeFetch(env, {
    path: "/api/v1/identity/users",
    method: "POST",
    body: JSON.stringify({ github_id: githubId }),
  });
  if (!createRes.ok) {
    throw new Error(`identity_create_user_failed:${createRes.status}`);
  }
  const userId = ((await createRes.json()) as IdentityUser).user_id;
  if (accessToken) {
    const email = await fetchGitHubVerifiedEmail(env, accessToken).catch(() => null);
    if (email) await linkEmailToUser(env, userId, email).catch(() => null);
  }
  return userId;
}

export async function findOrCreateUserByGoogle(
  env: AuthorizeEnv,
  googleSub: string,
  email?: string,
): Promise<string> {
  // 1. Find by Google sub
  const findRes = await authorizeFetch(env, {
    path: `/api/v1/identity/users/by-google/${encodeURIComponent(googleSub)}`,
    method: "GET",
  });
  if (findRes.ok) {
    const userId = ((await findRes.json()) as IdentityUser).user_id;
    // Store email even if user already exists (idempotent)
    if (email) await linkEmailToUser(env, userId, email).catch(() => null);
    return userId;
  }
  if (findRes.status !== 404) {
    throw new Error(`identity_find_google_failed:${findRes.status}`);
  }

  // 2. Try email-based linking (Google always provides verified email)
  if (email) {
    try {
      const userId = await findUserByEmail(env, email);
      if (userId) {
        await linkGoogleToUser(env, userId, googleSub);
        await linkEmailToUser(env, userId, email).catch(() => null);
        return userId;
      }
    } catch {
      // non-fatal
    }
  }

  // 3. Create new user with Google identity
  const createRes = await authorizeFetch(env, {
    path: "/api/v1/identity/users",
    method: "POST",
    body: JSON.stringify({ google_id: googleSub }),
  });
  if (!createRes.ok) {
    throw new Error(`identity_create_user_failed:${createRes.status}`);
  }
  const userId = ((await createRes.json()) as IdentityUser).user_id;
  if (email) await linkEmailToUser(env, userId, email).catch(() => null);
  return userId;
}

export async function listUserOrganizations(
  env: AuthorizeEnv,
  userId: string,
): Promise<IdentityOrg[]> {
  const res = await authorizeFetch(env, {
    path: `/api/v1/identity/organizations?user_id=${encodeURIComponent(userId)}`,
    method: "GET",
  });
  if (!res.ok) {
    throw new Error(`identity_list_orgs_failed:${res.status}`);
  }
  const data = (await res.json()) as { organizations: IdentityOrg[] };
  return data.organizations;
}

export async function createOrganization(
  env: AuthorizeEnv,
  userId: string,
  name: string,
): Promise<IdentityOrg> {
  const res = await authorizeFetch(env, {
    path: "/api/v1/identity/organizations",
    method: "POST",
    body: JSON.stringify({ user_id: userId, name }),
  });
  if (!res.ok) {
    throw new Error(`identity_create_org_failed:${res.status}`);
  }
  return (await res.json()) as IdentityOrg;
}
