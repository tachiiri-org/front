import type { AuthorizeEnv } from "./index";
import { serializeCookie } from "./cookies";
import { issueSessionToken, readSessionToken } from "./token";

// The signed identity cookie. Holds the authorization-bearing identity (the user, the
// selected group/tenant, and the derived org-user id) as an ES256-signed JWT, so the
// values the front trusts to build the internal token cannot be forged by a client.
//
// __Host- prefix: the browser only accepts it over HTTPS, with Path=/ and no Domain,
// which pins it to this exact origin. It is HttpOnly (JS cannot read it).
export const IDENTITY_COOKIE = "__Host-identity";

// A non-authorization, JS-readable hint of the selected group, used only by client-side
// UI (e.g. the org switcher). It is NEVER trusted for authorization — the server reads
// the group id from the signed cookie above. Forging it only affects the caller's own UI.
export const GROUP_HINT_COOKIE = "identity_group_id";

// Legacy plaintext cookies that this replaces; cleared on logout for a clean migration.
const LEGACY_COOKIES = ["identity_user_id", "org_user_id"];

const IDENTITY_TTL = 60 * 60 * 24; // 1 day

export type Identity = {
  userId: string;
  groupId?: string;
  orgUserId?: string;
};

// Read and verify the signed identity cookie. Returns null if absent, malformed, expired,
// or signature-invalid — i.e. anything not provably issued by this server is untrusted.
export async function readIdentity(env: AuthorizeEnv, request: Request): Promise<Identity | null> {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)__Host-identity=([^;]*)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  const claims = await readSessionToken<{ userId?: string; groupId?: string; orgUserId?: string }>(env, token);
  if (!claims?.userId) return null;
  return { userId: claims.userId, groupId: claims.groupId, orgUserId: claims.orgUserId };
}

// Build the Set-Cookie headers for an identity: the signed cookie plus the JS-readable
// group hint (only when a group is selected).
export async function identitySetCookies(env: AuthorizeEnv, identity: Identity): Promise<string[]> {
  const token = await issueSessionToken(env, { ...identity }, IDENTITY_TTL);
  const cookies = [
    serializeCookie(IDENTITY_COOKIE, token, { maxAge: IDENTITY_TTL, sameSite: "Lax" }),
  ];
  if (identity.groupId) {
    cookies.push(
      serializeCookie(GROUP_HINT_COOKIE, identity.groupId, { maxAge: IDENTITY_TTL, httpOnly: false, sameSite: "Lax" }),
    );
  }
  return cookies;
}

// Clear the identity cookies (and legacy plaintext ones).
export function identityClearCookies(): string[] {
  const cleared = [
    serializeCookie(IDENTITY_COOKIE, "", { maxAge: 0, sameSite: "Lax" }),
    serializeCookie(GROUP_HINT_COOKIE, "", { maxAge: 0, httpOnly: false, sameSite: "Lax" }),
  ];
  for (const name of LEGACY_COOKIES) {
    cleared.push(serializeCookie(name, "", { maxAge: 0, sameSite: "Lax" }));
  }
  return cleared;
}
