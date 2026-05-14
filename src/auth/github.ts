import { exchangeGitHubOAuthCode } from "../identify";
import { clearCookie, parseCookies, serializeCookie } from "./cookies";

const STATE_COOKIE_NAME = "github_explorer_oauth_state";
const STATE_TTL_SECONDS = 60 * 10;

type GitHubOAuthEnv = {
  readonly GITHUB_OAUTH_CLIENT_ID?: string;
  readonly FRONTEND_ORIGIN?: string;
  readonly IDENTIFY?: {
    fetch(request: Request): Promise<Response>;
  };
} & Parameters<typeof exchangeGitHubOAuthCode>[0];

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

function getMissingConfigKeys(env: GitHubOAuthEnv): string[] {
  const missing = ["GITHUB_OAUTH_CLIENT_ID"].filter((key) => !env[key as keyof GitHubOAuthEnv]);
  return missing;
}

export function handleGitHubOAuthStart(context: RouteContext): Response {
  const missingKeys = getMissingConfigKeys(context.env);
  if (missingKeys.length > 0) {
    return new Response(`Missing ${missingKeys.join(", ")}`, { status: 503 });
  }

  if (context.env.IDENTIFY_ORIGIN) {
    const scope = new URL(context.request.url).searchParams.get("scope") ?? "repo read:user";
    const startUrl = new URL("/github/oauth/start", context.env.IDENTIFY_ORIGIN);
    startUrl.searchParams.set("scope", scope);
    return Response.redirect(startUrl.toString(), 302);
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
  if (!context.env.IDENTIFY && !context.env.IDENTIFY_ORIGIN) {
    return new Response("Missing IDENTIFY configuration", { status: 503 });
  }

  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (context.env.IDENTIFY_ORIGIN) {
    const callbackUrl = new URL("/github/oauth/callback", context.env.IDENTIFY_ORIGIN);
    callbackUrl.searchParams.set("code", code ?? "");
    callbackUrl.searchParams.set("state", state ?? "");
    return Response.redirect(callbackUrl.toString(), 302);
  }

  const cookies = parseCookies(context.request);
  const storedState = cookies.get(STATE_COOKIE_NAME);

  if (!code || !state || !storedState || state !== storedState) {
    return new Response("GitHub OAuth state validation failed", { status: 400 });
  }

  await exchangeGitHubOAuthCode(context.env, code);

  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie(STATE_COOKIE_NAME, context.request));
  headers.set(
    "Location",
    `${resolveFrontendOrigin(context.request, context.env)}/?tab=openapi-explorer`,
  );

  return new Response(null, { status: 302, headers });
}
