import type { AuthorizeEnv } from "./index";
import { issueInternalToken, DEFAULT_ORGANIZATION_ID } from "./token";

async function resolveSecret(
  value: string | { get(): Promise<string> } | undefined,
): Promise<string | undefined> {
  if (value && typeof value !== "string") {
    return value.get();
  }
  return value;
}

function sanitizeHeaders(sourceHeaders?: HeadersInit): Headers {
  const headers = new Headers(sourceHeaders);
  headers.delete("authorization");
  headers.delete("x-internal-token");
  return headers;
}

export async function authorizeFetch(
  env: AuthorizeEnv,
  input: {
    path: string;
    method: string;
    body?: string;
    headers?: HeadersInit;
    audience?: string;
    tenantContext?: { tenantId?: string; subjectId?: string; orgId?: string };
    actorType?: 'human' | 'program' | 'ai';
    roles?: string[];
    scopes?: string[];
  },
): Promise<Response> {
  const hasBackend = Boolean((env.BACKEND || env.BACKEND_ORIGIN) && env.FRONT_TO_BACKEND_TOKEN);
  const hasAuthorize = Boolean((env.AUTHORIZE || env.AUTHORIZE_ORIGIN) && env.FRONT_TO_AUTHORIZE_TOKEN);

  if ((!hasBackend && !hasAuthorize) || !env.INTERNAL_AUTH_SIGNING_KEY) {
    return Response.json({ error: "authorize_not_configured" }, { status: 500 });
  }

  const audience = input.audience ?? (hasBackend ? "backend" : "authorize");
  const internalToken = hasBackend
    ? await resolveSecret(env.FRONT_TO_BACKEND_TOKEN)
    : await resolveSecret(env.FRONT_TO_AUTHORIZE_TOKEN);
  if (!internalToken) {
    return Response.json({ error: "authorize_not_configured" }, { status: 500 });
  }

  const headers = sanitizeHeaders(input.headers);
  headers.set("x-internal-token", internalToken);
  const tenantId = input.tenantContext?.tenantId;
  const subjectId = input.tenantContext?.subjectId;
  // org is derived from the group, not selected. A group-scoped operation performed by a
  // real subject (user/agent) is attributed to that group's org — currently the single
  // default org. Bootstrap/build calls (no subject) stay provider-anchored, so we only
  // attach org_id when both a group and a subject are present.
  // TODO(multi-org): resolve the real org for the group (j_tenancy) and pass
  // tenantContext.orgId explicitly once org-plan customers can own separate orgs.
  const orgId = input.tenantContext?.orgId ?? (tenantId && subjectId ? DEFAULT_ORGANIZATION_ID : undefined);
  headers.set(
    "authorization",
    `Bearer ${await issueInternalToken(env, {
      audience,
      tenantId,
      orgId,
      subjectId,
      actorType: input.actorType,
      roles: input.roles,
      scopes: input.scopes,
    })}`,
  );

  if (input.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (hasBackend) {
    if (env.BACKEND_ORIGIN) {
      return fetch(
        new URL(input.path, env.BACKEND_ORIGIN),
        {
          method: input.method,
          headers,
          body: input.body ?? null,
          ...(input.body ? ({ duplex: "half" } as RequestInit) : {}),
          redirect: "manual",
        },
      );
    }
    return env.BACKEND!.fetch(
      new Request(new URL(input.path, "https://backend.local").toString(), {
        method: input.method,
        headers,
        body: input.body ?? null,
        ...(input.body ? ({ duplex: "half" } as RequestInit) : {}),
        redirect: "manual",
      }),
    );
  }

  if (env.AUTHORIZE_ORIGIN) {
    return fetch(
      new URL(input.path, env.AUTHORIZE_ORIGIN),
      {
        method: input.method,
        headers,
        body: input.body ?? null,
        ...(input.body ? ({ duplex: "half" } as RequestInit) : {}),
        redirect: "manual",
      },
    );
  }

  return env.AUTHORIZE!.fetch(
    new Request(new URL(input.path, "https://authorize.local").toString(), {
      method: input.method,
      headers,
      body: input.body ?? null,
      ...(input.body ? ({ duplex: "half" } as RequestInit) : {}),
      redirect: "manual",
    }),
  );
}
