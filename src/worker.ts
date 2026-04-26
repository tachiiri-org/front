type Env = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  readonly LAYOUTS: R2Bucket;
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

const handleLayoutPut = async (request: Request, env: Env, id: string): Promise<Response> => {
  const body = await request.text();
  try {
    JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  await env.LAYOUTS.put(`${id}.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });
  return new Response(null, { status: 204 });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const layoutMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)$/);

    if (layoutMatch) {
      const id = layoutMatch[1];
      if (request.method === 'GET') return handleLayoutGet(env, id);
      if (request.method === 'PUT') return handleLayoutPut(request, env, id);
      return new Response('Method Not Allowed', { status: 405 });
    }

    const response = await env.ASSETS.fetch(request);

    if (response.status !== 404 || !isNavigationRequest(request)) {
      return response;
    }

    const indexRequest = new Request(new URL('/index.html', url), request);
    return env.ASSETS.fetch(indexRequest);
  },
};
