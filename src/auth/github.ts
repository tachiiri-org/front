import { exchangeGitHubOAuthCode } from "../identify";
import { clearCookie, parseCookies, serializeCookie } from "./cookies";
import type { AuthorizeEnv } from "./index";

type GitHubOAuthEnv = AuthorizeEnv;

type RouteContext = {
  request: Request;
  env: GitHubOAuthEnv;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createRandomState(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

function resolveFrontendOrigin(request: Request, env: GitHubOAuthEnv): string {
  return env.FRONTEND_ORIGIN ?? new URL(request.url).origin;
}

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function getGitHubCallbackUrl(request: Request, env: GitHubOAuthEnv): string {
  return new URL("/oauth/github/callback", resolveFrontendOrigin(request, env)).toString();
}

function buildGitHubAuthorizeUrl(request: Request, env: GitHubOAuthEnv, state: string, scope: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", getGitHubCallbackUrl(request, env));
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  return url.toString();
}

export function handleGitHubOAuthStart(context: RouteContext): Response {
  if (!context.env.GITHUB_OAUTH_CLIENT_ID) {
    return new Response("Missing GITHUB_OAUTH_CLIENT_ID", { status: 503 });
  }

  const state = createRandomState();
  const scope = new URL(context.request.url).searchParams.get("scope") ?? "repo read:user";
  const headers = new Headers();
  headers.set(
    "Set-Cookie",
    serializeCookie(STATE_COOKIE_NAME, state, {
      maxAge: STATE_TTL_SECONDS,
      path: "/",
      secure: isSecureRequest(context.request),
    }),
  );
  headers.set("Location", buildGitHubAuthorizeUrl(context.request, context.env, state, scope));

  return new Response(null, { status: 302, headers });
}

export async function handleGitHubOAuthCallback(context: RouteContext): Promise<Response> {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookies = parseCookies(context.request);
  const storedState = cookies.get(STATE_COOKIE_NAME);

  if (!code || !state || !storedState || state !== storedState) {
    return new Response("GitHub OAuth state validation failed", { status: 400 });
  }

  try {
    await exchangeGitHubOAuthCode(context.env, code, getGitHubCallbackUrl(context.request, context.env));
  } catch (error) {
    return new Response(`GitHub OAuth code exchange failed: ${String(error)}`, { status: 502 });
  }

  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie(STATE_COOKIE_NAME, context.request));
  headers.set(
    "Location",
    `${resolveFrontendOrigin(context.request, context.env)}/?tab=openapi-explorer`,
  );

  return new Response(null, { status: 302, headers });
}

const STATE_COOKIE_NAME = "github_explorer_oauth_state";
const STATE_TTL_SECONDS = 60 * 10;
