import { isComponent, isComponentDocument, isLayout, isSelectDocument } from './layout';

type Env = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  readonly LAYOUTS: R2Bucket;
};

const DEFAULT_COMPONENTS: Record<string, Record<string, unknown>> = {
  'sample/components/editor/layout-select': {
    kind: 'select',
    source: {
      kind: 'endpoint',
      url: '/api/layouts/json-files',
      itemsPath: 'items',
    },
  },
  'sample/components/editor/select': {
    kind: 'select',
    source: {
      kind: 'endpoint',
      url: '/api/layouts/{{layout-select}}/json-files?prefix=components/',
      itemsPath: 'items',
    },
  },
  'sample/components/editor/form': {
    kind: 'form',
    sourceComponentId: 'component-select',
    excludeKeys: ['kind'],
  },
};

type ListItem = {
  value: string;
  label: string;
};

const buildJsonFileItems = async (
  env: Env,
  prefixKey: string,
  options?: { excludeNested?: boolean },
): Promise<ListItem[]> => {
  const seen = new Map<string, ListItem>();

  let cursor: string | undefined;
  do {
    const result = await env.LAYOUTS.list({ prefix: prefixKey, cursor });
    for (const object of result.objects) {
      if (!object.key.endsWith('.json')) continue;
      const relative = object.key.slice(prefixKey.length);
      if (options?.excludeNested && relative.includes('/')) continue;
      const value = relative.slice(0, -'.json'.length);
      if (!seen.has(value)) {
        seen.set(value, { value, label: value });
      }
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);

  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
};

const isNavigationRequest = (request: Request): boolean => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('text/html');
};

const handleLayoutGet = async (env: Env, id: string): Promise<Response> => {
  const object = await env.LAYOUTS.get(`${id}.json`);
  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  return new Response(object.body, {
    headers: { 'Content-Type': 'application/json' },
  });
};

const handleLayoutsJsonFilesGet = async (env: Env): Promise<Response> => {
  const items = await buildJsonFileItems(env, '', { excludeNested: true });
  return new Response(JSON.stringify({ items }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

const handleComponentGet = async (env: Env, layoutId: string, componentId: string): Promise<Response> => {
  const object = await env.LAYOUTS.get(`${layoutId}/components/${componentId}.json`);
  if (!object) {
    const fallback = DEFAULT_COMPONENTS[`${layoutId}/components/${componentId}`];
    if (!fallback) {
      return new Response('Not Found', { status: 404 });
    }

    return new Response(JSON.stringify(fallback), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(object.body, {
    headers: { 'Content-Type': 'application/json' },
  });
};

const handleJsonFilesGet = async (env: Env, layoutId: string, prefix: string): Promise<Response> => {
  const items = await buildJsonFileItems(env, `${layoutId}/${prefix}`);
  return new Response(JSON.stringify({ items }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

const handleLayoutPut = async (request: Request, env: Env, id: string): Promise<Response> => {
  const body = await request.text();

  try {
    const value = JSON.parse(body) as unknown;
    if (!isLayout(value)) {
      return new Response('Invalid layout', { status: 400 });
    }
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  await env.LAYOUTS.put(`${id}.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });

  return new Response(null, { status: 204 });
};

const handleComponentPut = async (
  request: Request,
  env: Env,
  layoutId: string,
  componentId: string,
): Promise<Response> => {
  const body = await request.text();

  try {
    const value = JSON.parse(body) as unknown;
    if (
      (!isComponentDocument(value) && !isComponent(value)) ||
      (typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).kind === 'select' &&
        !isSelectDocument(value))
    ) {
      return new Response('Invalid component', { status: 400 });
    }
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  await env.LAYOUTS.put(`${layoutId}/components/${componentId}.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });

  return new Response(null, { status: 204 });
};

const handleComponentDelete = async (env: Env, layoutId: string, componentId: string): Promise<Response> => {
  await env.LAYOUTS.delete(`${layoutId}/components/${componentId}.json`);
  return new Response(null, { status: 204 });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const componentMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/components\/(.+)$/);
    if (componentMatch) {
      const layoutId = decodeURIComponent(componentMatch[1]);
      const componentId = decodeURIComponent(componentMatch[2]);
      if (request.method === 'GET') return handleComponentGet(env, layoutId, componentId);
      if (request.method === 'PUT') return handleComponentPut(request, env, layoutId, componentId);
      if (request.method === 'DELETE') return handleComponentDelete(env, layoutId, componentId);
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url.pathname === '/api/layouts/json-files') {
      if (request.method === 'GET') return handleLayoutsJsonFilesGet(env);
      return new Response('Method Not Allowed', { status: 405 });
    }

    const jsonFilesMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/json-files$/);
    if (jsonFilesMatch) {
      const layoutId = decodeURIComponent(jsonFilesMatch[1]);
      if (request.method === 'GET') {
        const prefix = url.searchParams.get('prefix') ?? 'components/';
        return handleJsonFilesGet(env, layoutId, prefix);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    const layoutMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)$/);
    if (layoutMatch) {
      const id = decodeURIComponent(layoutMatch[1]);
      if (request.method === 'GET') return handleLayoutGet(env, id);
      if (request.method === 'PUT') return handleLayoutPut(request, env, id);
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (isNavigationRequest(request)) {
      return new Response('<!doctype html><script type="module" src="/app.js"></script>', {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
