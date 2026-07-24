import type { AuthorizeEnv } from "./index";

// Canonical origin for building redirect / OAuth-callback URLs.
//
// Prefer the request origin for our own hosts (*.tachiiri.com auth/product domains and the
// *.workers.dev app hosts) so per-domain flows (e.g. authn.tachiiri.com) build correct
// callback URLs. Fall back to the pinned FRONTEND_ORIGIN only for unrecognized hosts —
// Cloudflare already routes by Host, and the suffix allowlist guards against Host spoofing.
export function resolveOrigin(request: Request, env: Pick<AuthorizeEnv, "FRONTEND_ORIGIN">): string {
  const url = new URL(request.url);
  if (url.hostname.endsWith(".tachiiri.com") || url.hostname.endsWith(".workers.dev")) {
    return url.origin;
  }
  return env.FRONTEND_ORIGIN ?? url.origin;
}
