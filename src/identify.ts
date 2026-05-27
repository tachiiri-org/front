import { authorizeFetch, type AuthorizeEnv } from "./auth";

export type IdentifyGitHubSession = {
  authenticated: true;
  accessToken: string;
  viewer: {
    login: string;
    name: string | null;
  };
};

export function buildGitHubOAuthStartUrl(
  env: Pick<AuthorizeEnv, "FRONTEND_ORIGIN">,
  scope = "repo read:user",
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
