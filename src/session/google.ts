import { exchangeGoogleOAuthCode, serializeGoogleSessionCookie, findOrCreateUserByGoogle, linkGoogleToUser, registerLoginEmailToGroup } from "../identify";
import { clearCookie, parseCookies, serializeCookie } from "./cookies";
import { resolveOrigin } from "./origin";
import { readIdentity, identitySetCookies } from "./identity";
import type { AuthorizeEnv } from "./index";

type GoogleOAuthEnv = AuthorizeEnv;

type RouteContext = {
  request: Request;
  env: GoogleOAuthEnv;
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

function resolveFrontendOrigin(request: Request, env: GoogleOAuthEnv): string {
  return resolveOrigin(request, env);
}

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function getGoogleCallbackUrl(request: Request, env: GoogleOAuthEnv): string {
  return new URL("/oauth/google/callback", resolveFrontendOrigin(request, env)).toString();
}

function buildGoogleAuthorizeUrl(request: Request, env: GoogleOAuthEnv, state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", getGoogleCallbackUrl(request, env));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  return url.toString();
}

export function handleGoogleLoginStart(context: RouteContext): Response {
  if (!context.env.GOOGLE_OAUTH_CLIENT_ID) {
    return new Response("Missing GOOGLE_OAUTH_CLIENT_ID", { status: 503 });
  }

  const returnTo = new URL(context.request.url).searchParams.get("returnTo") ?? "";
  const state = createRandomState();
  const secure = isSecureRequest(context.request);
  const headers = new Headers();
  headers.set(
    "Set-Cookie",
    serializeCookie(LOGIN_STATE_COOKIE_NAME, state, {
      maxAge: STATE_TTL_SECONDS,
      path: "/",
      secure,
    }),
  );
  if (returnTo.startsWith("/")) {
    headers.append(
      "Set-Cookie",
      serializeCookie(LOGIN_RETURN_TO_COOKIE, returnTo, {
        maxAge: STATE_TTL_SECONDS,
        path: "/",
        secure,
        httpOnly: true,
      }),
    );
  }
  headers.set("Location", buildGoogleAuthorizeUrl(context.request, context.env, state));

  return new Response(null, { status: 302, headers });
}

export async function handleGoogleLoginCallback(context: RouteContext): Promise<Response> {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookies = parseCookies(context.request);
  const storedState = cookies.get(LOGIN_STATE_COOKIE_NAME);

  if (!code || !state || !storedState || state !== storedState) {
    return new Response("Google OAuth state validation failed", { status: 400 });
  }

  let googleSession;
  try {
    googleSession = await exchangeGoogleOAuthCode(context.env, code, getGoogleCallbackUrl(context.request, context.env));
  } catch (error) {
    return new Response(`Google OAuth code exchange failed: ${String(error)}`, { status: 502 });
  }

  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie(LOGIN_STATE_COOKIE_NAME, context.request));

  const cookies2 = parseCookies(context.request);
  const linkMode = cookies2.get(IDENTITY_LINK_MODE_COOKIE);
  const existingUserId = linkMode ? (await readIdentity(context.env, context.request))?.userId ?? null : null;

  try {
    headers.append("Set-Cookie", await serializeGoogleSessionCookie(googleSession, context.env, context.request));
    if (linkMode && existingUserId) {
      await linkGoogleToUser(context.env, existingUserId, googleSession.sub);
      headers.append("Set-Cookie", `${IDENTITY_LINK_MODE_COOKIE}=; Path=/; Max-Age=0`);
    } else {
      const userId = await findOrCreateUserByGoogle(context.env, googleSession.sub);
      for (const c of await identitySetCookies(context.env, { userId })) {
        headers.append("Set-Cookie", c);
      }
      // email を group DB に着地させる（cookie/認証DB を経由しない）。手元の googleSession.email を使う。
      await registerLoginEmailToGroup(context.env, userId, googleSession.email);
    }
  } catch {
    // identity lookup failure is non-fatal; org-select page will handle the missing state
  }

  const loginReturnTo = cookies2.get(LOGIN_RETURN_TO_COOKIE) ?? "";
  headers.append("Set-Cookie", clearCookie(LOGIN_RETURN_TO_COOKIE, context.request));
  const groupSelectDest = loginReturnTo.startsWith("/")
    ? `/group-select?returnTo=${encodeURIComponent(loginReturnTo)}`
    : "/group-select";
  const dest = linkMode && existingUserId
    ? `${resolveFrontendOrigin(context.request, context.env)}/settings`
    : cookies2.has(MCP_OAUTH_PARAMS_COOKIE)
    ? `${resolveFrontendOrigin(context.request, context.env)}/oauth/mcp/select-org`
    : `${resolveFrontendOrigin(context.request, context.env)}${groupSelectDest}`;
  headers.set("Location", dest);
  return new Response(null, { status: 302, headers });
}

const LOGIN_STATE_COOKIE_NAME = "__Host-google_login_oauth_state";
const LOGIN_RETURN_TO_COOKIE = "__Host-google_login_return_to";
const IDENTITY_USER_ID_COOKIE = "identity_user_id";
const IDENTITY_LINK_MODE_COOKIE = "identity_link_mode";
export const MCP_OAUTH_PARAMS_COOKIE = "__Host-mcp_oauth_params";
const STATE_TTL_SECONDS = 60 * 10;
