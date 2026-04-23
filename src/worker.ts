type AssetsEnv = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
};

const isNavigationRequest = (request: Request): boolean => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('text/html');
};

export default {
  async fetch(request: Request, env: AssetsEnv): Promise<Response> {
    const response = await env.ASSETS.fetch(request);

    if (response.status !== 404 || !isNavigationRequest(request)) {
      return response;
    }

    const url = new URL(request.url);
    const indexRequest = new Request(new URL('/index.html', url), request);

    return env.ASSETS.fetch(indexRequest);
  },
};
