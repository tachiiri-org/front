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
