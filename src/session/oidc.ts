import { exchangeOidcOAuthCode, serializeOidcSessionCookie, findOrCreateUserByOidc } from "../identify";
import { clearCookie, parseCookies, serializeCookie } from "./cookies";
import { identitySetCookies } from "./identity";
import type { AuthorizeEnv } from "./index";
import { authorizeFetch } from "./fetch";
import { MCP_OAUTH_PARAMS_COOKIE } from "./google";

const OIDC_STATE_COOKIE = "__Host-oidc_login_oauth_state";
const OIDC_ID_COOKIE = "__Host-oidc_login_oidc_id";
const OIDC_RETURN_TO_COOKIE = "__Host-oidc_login_return_to";
export const OIDC_ORG_ID_COOKIE = "__Host-oidc_login_org_id";
const IDENTITY_USER_ID_COOKIE = "identity_user_id";
const STATE_TTL_SECONDS = 60 * 10;

type RouteContext = {
  request: Request;
  env: AuthorizeEnv;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createRandomState(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

function resolveFrontendOrigin(request: Request, env: AuthorizeEnv): string {
  return env.FRONTEND_ORIGIN ?? new URL(request.url).origin;
}

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function getOidcCallbackUrl(request: Request, env: AuthorizeEnv): string {
  return new URL("/oauth/oidc/callback", resolveFrontendOrigin(request, env)).toString();
}

export async function handleOidcLoginStart(context: RouteContext, oidcId: string): Promise<Response> {
  // Fetch OIDC provider config via authorize backend (bypasses front worker routing)
  const configRes = await authorizeFetch(context.env, {
    path: `/api/v1/identity/oidc/${encodeURIComponent(oidcId)}`,
    method: "GET",
  });

  if (!configRes.ok) {
    return new Response("OIDC provider not found", { status: 404 });
  }

  const config = (await configRes.json()) as { issuer: string; app_id: string; name: string };

  const state = createRandomState();
  const discoveryUrl = `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;

  let authorizeEndpoint: string;
  try {
    const discovery = (await (await fetch(discoveryUrl, { headers: { "User-Agent": "tachiiri-front/1.0" } })).json()) as { authorization_endpoint: string };
    authorizeEndpoint = discovery.authorization_endpoint;
  } catch {
    return new Response("OIDC discovery failed", { status: 502 });
  }

  const authorizeUrl = new URL(authorizeEndpoint);
  authorizeUrl.searchParams.set("client_id", config.app_id);
  authorizeUrl.searchParams.set("redirect_uri", getOidcCallbackUrl(context.request, context.env));
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "openid email profile");
  authorizeUrl.searchParams.set("state", state);

  const returnTo = new URL(context.request.url).searchParams.get("returnTo") ?? "";
  const secure = isSecureRequest(context.request);
  const headers = new Headers();
  headers.set("Location", authorizeUrl.toString());
  headers.append("Set-Cookie", serializeCookie(OIDC_STATE_COOKIE, state, {
    maxAge: STATE_TTL_SECONDS, path: "/", secure, httpOnly: true, sameSite: "Lax",
  }));
  headers.append("Set-Cookie", serializeCookie(OIDC_ID_COOKIE, oidcId, {
    maxAge: STATE_TTL_SECONDS, path: "/", secure, httpOnly: true, sameSite: "Lax",
  }));
  if (returnTo.startsWith("/")) {
    headers.append("Set-Cookie", serializeCookie(OIDC_RETURN_TO_COOKIE, returnTo, {
      maxAge: STATE_TTL_SECONDS, path: "/", secure, httpOnly: true, sameSite: "Lax",
    }));
  }

  return new Response(null, { status: 302, headers });
}

export async function handleOidcLoginCallback(context: RouteContext): Promise<Response> {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookies = parseCookies(context.request);
  const storedState = cookies.get(OIDC_STATE_COOKIE);
  const oidcId = cookies.get(OIDC_ID_COOKIE);

  if (!code || !state || !storedState || state !== storedState || !oidcId) {
    return new Response("OIDC state validation failed", { status: 400 });
  }

  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie(OIDC_STATE_COOKIE, context.request));
  headers.append("Set-Cookie", clearCookie(OIDC_ID_COOKIE, context.request));

  let oidcSession;
  try {
    oidcSession = await exchangeOidcOAuthCode(context.env, oidcId, code, getOidcCallbackUrl(context.request, context.env));
  } catch (error) {
    return new Response(`OIDC code exchange failed: ${String(error)}`, { status: 502 });
  }

  try {
    headers.append("Set-Cookie", await serializeOidcSessionCookie(oidcSession, context.env, context.request));

    const userId = await findOrCreateUserByOidc(context.env, oidcId, oidcSession.sub);
    for (const c of await identitySetCookies(context.env, { userId })) {
      headers.append("Set-Cookie", c);
    }
  } catch {
    // identity lookup failure is non-fatal; org-select page will handle missing state
  }

  const loginReturnTo = cookies.get(OIDC_RETURN_TO_COOKIE) ?? "";
  headers.append("Set-Cookie", clearCookie(OIDC_RETURN_TO_COOKIE, context.request));

  const orgId = cookies.get(OIDC_ORG_ID_COOKIE) ?? "";
  headers.append("Set-Cookie", clearCookie(OIDC_ORG_ID_COOKIE, context.request));

  let dest: string;
  if (cookies.has(MCP_OAUTH_PARAMS_COOKIE)) {
    dest = `${resolveFrontendOrigin(context.request, context.env)}/oauth/mcp/select-org`;
  } else if (orgId) {
    const returnPart = loginReturnTo.startsWith("/") ? `&returnTo=${encodeURIComponent(loginReturnTo)}` : "";
    dest = `${resolveFrontendOrigin(context.request, context.env)}/org-group-select?org_id=${encodeURIComponent(orgId)}${returnPart}`;
  } else {
    const groupSelectDest = loginReturnTo.startsWith("/")
      ? `/group-select?returnTo=${encodeURIComponent(loginReturnTo)}`
      : "/group-select";
    dest = `${resolveFrontendOrigin(context.request, context.env)}${groupSelectDest}`;
  }

  headers.set("Location", dest);
  return new Response(null, { status: 302, headers });
}

export function clearOidcSessionCookies(request: Request): string[] {
  return [clearCookie("__Host-oidc_session", request)];
}
