import { exchangeGitHubOAuthCode, exchangeGitHubConnectCode, serializeGitHubSessionCookie, serializeGitHubConnectSessionCookie, findOrCreateUserByGitHub } from "../identify";
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

function getGitHubLoginCallbackUrl(request: Request, env: GitHubOAuthEnv): string {
  return new URL("/oauth/github/callback", resolveFrontendOrigin(request, env)).toString();
}

function getGitHubConnectCallbackUrl(request: Request, env: GitHubOAuthEnv): string {
  return getGitHubLoginCallbackUrl(request, env);
}

/** @deprecated Use getGitHubLoginCallbackUrl or getGitHubConnectCallbackUrl */
function getGitHubCallbackUrl(request: Request, env: GitHubOAuthEnv): string {
  return getGitHubLoginCallbackUrl(request, env);
}

function buildGitHubAuthorizeUrl(request: Request, env: GitHubOAuthEnv, state: string, scope: string, callbackUrl?: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", callbackUrl ?? getGitHubCallbackUrl(request, env));
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  return url.toString();
}

// GitHub login start (scope: read:user user:email — identity + verified email)
export function handleGitHubLoginStart(context: RouteContext): Response {
  if (!context.env.GITHUB_OAUTH_CLIENT_ID) {
    return new Response("Missing GITHUB_OAUTH_CLIENT_ID", { status: 503 });
  }

  const state = createRandomState();
  const scope = "read:user user:email";
  const headers = new Headers();
  headers.set(
    "Set-Cookie",
    serializeCookie(LOGIN_STATE_COOKIE_NAME, state, {
      maxAge: STATE_TTL_SECONDS,
      path: "/",
      secure: isSecureRequest(context.request),
    }),
  );
  headers.set("Location", buildGitHubAuthorizeUrl(context.request, context.env, state, scope));

  return new Response(null, { status: 302, headers });
}

export async function handleGitHubLoginCallback(context: RouteContext): Promise<Response> {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookies = parseCookies(context.request);

  // If the connect state cookie matches, route to connect handler
  const connectState = cookies.get(CONNECT_STATE_COOKIE_NAME);
  if (connectState && state === connectState) {
    return handleGitHubConnectCallback(context);
  }

  const storedState = cookies.get(LOGIN_STATE_COOKIE_NAME);

  if (!code || !state || !storedState || state !== storedState) {
    return new Response("GitHub OAuth state validation failed", { status: 400 });
  }

  let session;
  try {
    session = await exchangeGitHubOAuthCode(context.env, code, getGitHubLoginCallbackUrl(context.request, context.env));
  } catch (error) {
    return new Response(`GitHub OAuth code exchange failed: ${String(error)}`, { status: 502 });
  }

  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie(LOGIN_STATE_COOKIE_NAME, context.request));

  try {
    headers.append("Set-Cookie", await serializeGitHubSessionCookie(session, context.env, context.request));
    const userId = await findOrCreateUserByGitHub(context.env, session.viewer.login, session.email);
    headers.append(
      "Set-Cookie",
      serializeCookie(IDENTITY_USER_ID_COOKIE, userId, {
        maxAge: 60 * 10,
        path: "/",
        secure: isSecureRequest(context.request),
        httpOnly: true,
      }),
    );
  } catch {
    // identity lookup failure is non-fatal; org-select page will handle the missing state
  }

  const cookies2 = parseCookies(context.request);
  const dest = cookies2.has(MCP_OAUTH_PARAMS_COOKIE)
    ? `${resolveFrontendOrigin(context.request, context.env)}/oauth/mcp/select-org`
    : `${resolveFrontendOrigin(context.request, context.env)}/org-select`;
  headers.set("Location", dest);
  return new Response(null, { status: 302, headers });
}

// GitHub connect start (scope: repo etc. — resource access)
export function handleGitHubConnectStart(context: RouteContext): Response {
  if (!context.env.GITHUB_OAUTH_CLIENT_ID) {
    return new Response("Missing GITHUB_OAUTH_CLIENT_ID", { status: 503 });
  }

  const state = createRandomState();
  const scope = new URL(context.request.url).searchParams.get("scope") ?? "repo read:user";
  const headers = new Headers();
  headers.set(
    "Set-Cookie",
    serializeCookie(CONNECT_STATE_COOKIE_NAME, state, {
      maxAge: STATE_TTL_SECONDS,
      path: "/",
      secure: isSecureRequest(context.request),
    }),
  );
  headers.set("Location", buildGitHubAuthorizeUrl(context.request, context.env, state, scope, getGitHubConnectCallbackUrl(context.request, context.env)));

  return new Response(null, { status: 302, headers });
}

export async function handleGitHubConnectCallback(context: RouteContext): Promise<Response> {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookies = parseCookies(context.request);
  const storedState = cookies.get(CONNECT_STATE_COOKIE_NAME);

  if (!code || !state || !storedState || state !== storedState) {
    return new Response("GitHub OAuth state validation failed", { status: 400 });
  }

  let connectSession;
  try {
    connectSession = await exchangeGitHubConnectCode(context.env, code, getGitHubConnectCallbackUrl(context.request, context.env));
  } catch (error) {
    return new Response(`GitHub connect OAuth code exchange failed: ${String(error)}`, { status: 502 });
  }

  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie(CONNECT_STATE_COOKIE_NAME, context.request));
  try {
    headers.append("Set-Cookie", await serializeGitHubConnectSessionCookie(connectSession, context.env, context.request));
  } catch { /* non-fatal */ }
  headers.set("Location", `${resolveFrontendOrigin(context.request, context.env)}/identify-viewer`);

  return new Response(null, { status: 302, headers });
}

/** @deprecated Use handleGitHubLoginStart */
export function handleGitHubOAuthStart(context: RouteContext): Response {
  return handleGitHubLoginStart(context);
}

/** @deprecated Use handleGitHubLoginCallback */
export async function handleGitHubOAuthCallback(context: RouteContext): Promise<Response> {
  return handleGitHubLoginCallback(context);
}

const LOGIN_STATE_COOKIE_NAME = "github_login_oauth_state";
const CONNECT_STATE_COOKIE_NAME = "github_connect_oauth_state";
export const IDENTITY_USER_ID_COOKIE = "identity_user_id";
export const MCP_OAUTH_PARAMS_COOKIE = "mcp_oauth_params";
/** @deprecated Use LOGIN_STATE_COOKIE_NAME or CONNECT_STATE_COOKIE_NAME */
const STATE_COOKIE_NAME = LOGIN_STATE_COOKIE_NAME;
const STATE_TTL_SECONDS = 60 * 10;
