type SecretValue = string | { get(): Promise<string> };

export type IdentifyService = {
  fetch(request: Request): Promise<Response>;
};

export type IdentifyEnv = {
  readonly IDENTIFY?: IdentifyService;
  readonly IDENTIFY_ORIGIN?: string;
  readonly FRONT_TO_IDENTIFY_TOKEN?: SecretValue;
  readonly FRONTEND_ORIGIN?: string;
};

export type IdentifyGitHubSession = {
  authenticated: true;
  accessToken: string;
  viewer: {
    login: string;
    name: string | null;
  };
};

const buildFrontendOrigin = (env: IdentifyEnv): string => {
  if (env.FRONTEND_ORIGIN) {
    return env.FRONTEND_ORIGIN;
  }
  if (env.IDENTIFY_ORIGIN) {
    return env.IDENTIFY_ORIGIN;
  }
  throw new Error("frontend_origin_not_configured");
};

export function buildGitHubOAuthStartUrl(
  env: IdentifyEnv,
  scope = "repo read:user",
): string {
  const url = new URL("/oauth/github/start", buildFrontendOrigin(env));
  if (scope) {
    url.searchParams.set("scope", scope);
  }
  return url.toString();
}

async function resolveSecret(value: SecretValue | undefined): Promise<string | undefined> {
  if (value && typeof value !== "string") {
    return value.get();
  }
  return value;
}

async function fetchIdentify(
  env: IdentifyEnv,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = await resolveSecret(env.FRONT_TO_IDENTIFY_TOKEN);
  if (token) {
    headers.set("x-front-to-identify-token", token);
  }

  if (env.IDENTIFY) {
    return env.IDENTIFY.fetch(
      new Request(new URL(path, "https://identify.internal").toString(), {
        ...init,
        headers,
        redirect: "manual",
        body: init.body ?? null,
        ...(init.body ? ({ duplex: "half" } as RequestInit) : {}),
      }),
    );
  }

  if (!env.IDENTIFY_ORIGIN) {
    throw new Error("identify_not_configured");
  }

  return fetch(
    new URL(path, env.IDENTIFY_ORIGIN),
    {
      ...init,
      headers,
      redirect: "manual",
    },
  );
}

export async function readGitHubSession(
  env: IdentifyEnv,
): Promise<IdentifyGitHubSession | null> {
  const response = await fetchIdentify(env, "/internal/github/session");
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
  env: IdentifyEnv,
  code: string,
): Promise<void> {
  const response = await fetchIdentify(env, "/internal/github/oauth/callback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    throw new Error(`identify_github_oauth_exchange_failed:${response.status}`);
  }
}
