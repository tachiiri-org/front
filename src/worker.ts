import { isComponent, isComponentDocument, isLayout } from './layout';

type Env = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  readonly LAYOUTS: R2Bucket;
};

const DEFAULT_LAYOUTS: Record<string, unknown> = {
  sample: {
    head: { title: 'Sample', meta: [] },
    shell: {},
    components: [
      { id: 'editor-heading', kind: 'heading', src: 'editor/heading' },
      { id: 'editor-form', kind: 'form', src: 'editor/form' },
    ],
  },
};

const DEFAULT_COMPONENTS: Record<string, Record<string, unknown>> = {
  'sample/components/editor/heading': {
    kind: 'heading',
    level: 1,
    text: 'Components',
  },
  'sample/components/editor/picker': {
    kind: 'select',
    selected: 'editor-form',
    options: [
      { value: 'editor-heading', label: 'Components' },
      { value: 'editor-form', label: 'Sample Form' },
    ],
    variants: {
      'editor-heading': {
        kind: 'heading',
        level: 1,
        text: 'Components',
      },
      'editor-form': {
        kind: 'form',
        title: 'Sample Form',
      },
    },
  },
  'sample/components/editor/form': {
    kind: 'form',
    title: 'Sample Form',
  },
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
    const fallback = DEFAULT_LAYOUTS[id];
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
    if (!isComponentDocument(value) && !isComponent(value)) {
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const componentMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/components\/(.+)$/);
    if (componentMatch) {
      const layoutId = decodeURIComponent(componentMatch[1]);
      const componentId = decodeURIComponent(componentMatch[2]);
      if (request.method === 'GET') return handleComponentGet(env, layoutId, componentId);
      if (request.method === 'PUT') return handleComponentPut(request, env, layoutId, componentId);
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
