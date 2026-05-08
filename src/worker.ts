import { createLayoutsBackend, type LayoutsEnv } from './layouts/backend';
import {
  handleScreenGet,
  handleScreensJsonFilesGet,
  handleComponentGet,
  handleJsonFilesGet,
  handleScreenPut,
  handleScreenDelete,
  handleScreenRename,
  handleComponentPut,
  handleComponentDelete,
} from './layouts/handlers';

type Env = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
} & LayoutsEnv;

const isNavigationRequest = (request: Request): boolean => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('text/html');
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const layouts = createLayoutsBackend(env);

    const componentMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/components\/(.+)$/);
    if (componentMatch) {
      const screenId = decodeURIComponent(componentMatch[1]);
      const componentId = decodeURIComponent(componentMatch[2]);
      if (request.method === 'GET') return handleComponentGet(layouts, screenId, componentId);
      if (request.method === 'PUT') return handleComponentPut(request, layouts, screenId, componentId);
      if (request.method === 'DELETE') return handleComponentDelete(layouts, screenId, componentId);
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url.pathname === '/api/layouts/json-files') {
      if (request.method === 'GET') return handleScreensJsonFilesGet(layouts);
      return new Response('Method Not Allowed', { status: 405 });
    }

    const jsonFilesMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/json-files$/);
    if (jsonFilesMatch) {
      const screenId = decodeURIComponent(jsonFilesMatch[1]);
      if (request.method === 'GET') {
        const prefix = url.searchParams.get('prefix') ?? 'components/';
        return handleJsonFilesGet(layouts, screenId, prefix);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    const renameMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/rename$/);
    if (renameMatch) {
      const id = decodeURIComponent(renameMatch[1]);
      if (request.method === 'POST') return handleScreenRename(request, layouts, id);
      return new Response('Method Not Allowed', { status: 405 });
    }

    const screenMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)$/);
    if (screenMatch) {
      const id = decodeURIComponent(screenMatch[1]);
      if (request.method === 'GET') return handleScreenGet(layouts, id);
      if (request.method === 'PUT') return handleScreenPut(request, layouts, id);
      if (request.method === 'DELETE') return handleScreenDelete(layouts, id);
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (isNavigationRequest(request)) {
      return new Response('<!doctype html><script type="module" src="/client.js"></script>', {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
