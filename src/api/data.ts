import type { SpecDocument } from '../shared/spec-document';
import type { UiShellSettings } from '../shared/ui-shell-settings';
import { readGitHubSession, readGitHubConnectSession, readGoogleSession } from '../identify';
import type { AuthorizeEnv } from '../auth';

type StoredObject = {
  text(): Promise<string>;
};

export type LayoutsBucket = {
  get(key: string): Promise<StoredObject | null>;
  put(
    key: string,
    value: string,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
    },
  ): Promise<unknown>;
};

type ApiEnv = {
  readonly LAYOUTS?: LayoutsBucket;
};

const SPEC_DOCUMENT_KEY = 'spec-document.json';
const UI_SHELL_SETTINGS_KEY = 'ui-shell-settings.json';

const json = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...init?.headers,
    },
  });

const readJson = async <T>(object: StoredObject): Promise<T> => {
  return JSON.parse(await object.text()) as T;
};

const requireLayouts = (env: ApiEnv): LayoutsBucket | Response => {
  if (!env.LAYOUTS) {
    return json({ error: 'layouts_not_configured' }, { status: 503 });
  }

  return env.LAYOUTS;
};

const handleGet = async <T>(
  bucket: LayoutsBucket,
  key: string,
  fallback: T,
): Promise<Response> => {
  const object = await bucket.get(key);

  if (!object) {
    return json(fallback, { status: 200 });
  }

  return json(await readJson<T>(object), { status: 200 });
};

const handlePut = async <T>(
  request: Request,
  bucket: LayoutsBucket,
  key: string,
): Promise<Response> => {
  const value = (await request.json()) as T;

  await bucket.put(key, `${JSON.stringify(value, null, 2)}\n`, {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
    },
  });

  return json(value, { status: 200 });
};

export async function handleApiRequest(request: Request, env: ApiEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const bucket = requireLayouts(env);

  if (bucket instanceof Response) {
    return bucket;
  }

  if (pathname === '/api/spec-document') {
    if (request.method === 'GET') {
      return handleGet<SpecDocument | null>(bucket, SPEC_DOCUMENT_KEY, null);
    }
    if (request.method === 'PUT') {
      return handlePut<SpecDocument>(request, bucket, SPEC_DOCUMENT_KEY);
    }
  }

  if (pathname === '/api/ui-shell-settings') {
    if (request.method === 'GET') {
      return handleGet<UiShellSettings>(bucket, UI_SHELL_SETTINGS_KEY, { topics: {} });
    }
    if (request.method === 'PUT') {
      return handlePut<UiShellSettings>(request, bucket, UI_SHELL_SETTINGS_KEY);
    }
  }

  return null;
}

export async function handleGitHubAuthStatus(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/auth/github/status') {
    return null;
  }

  try {
    const session = await readGitHubSession(env);
    return json(
      {
        authenticated: Boolean(session),
        login: session?.viewer.login ?? null,
      },
      { status: 200 },
    );
  } catch {
    return json({ authenticated: false, login: null }, { status: 200 });
  }
}

export async function handleAuthStatus(
  request: Request,
  env: AuthorizeEnv,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/auth/status') {
    return null;
  }

  const [githubResult, githubConnectResult, googleResult] = await Promise.allSettled([
    readGitHubSession(env),
    readGitHubConnectSession(env),
    readGoogleSession(env),
  ]);

  const githubSession = githubResult.status === 'fulfilled' ? githubResult.value : null;
  const githubConnectSession = githubConnectResult.status === 'fulfilled' ? githubConnectResult.value : null;
  const googleSession = googleResult.status === 'fulfilled' ? googleResult.value : null;

  return json(
    {
      github: {
        authenticated: Boolean(githubSession),
        login: githubSession?.viewer.login ?? null,
      },
      githubConnect: {
        authenticated: Boolean(githubConnectSession),
        scopes: githubConnectSession?.scopes ?? null,
      },
      google: {
        authenticated: Boolean(googleSession),
        email: googleSession?.email ?? null,
        name: googleSession?.name ?? null,
      },
    },
    { status: 200 },
  );
}
