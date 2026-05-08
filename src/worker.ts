import { createLayoutsBackend, type LayoutsEnv, type LayoutBackend } from './layouts/r2';
import {
  handleScreenGet,
  handleComponentGet,
  handleJsonFilesGet,
  handleScreenPut,
  handleScreenDelete,
  handleScreenRename,
  handleComponentPut,
  handleComponentDelete,
  handleResourceListGet,
  handleResourceGet,
  handleResourcePut,
  handleResourceDelete,
  handleResourceRename,
} from './layouts/http';

type Env = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
} & LayoutsEnv;

type ResourceConfig = {
  name: string;
  storagePrefix: string;
  handleGet?: (backend: LayoutBackend, id: string) => Promise<Response>;
  handlePut?: (request: Request, backend: LayoutBackend, id: string) => Promise<Response>;
  handleDelete?: (backend: LayoutBackend, id: string) => Promise<Response>;
  handleRename?: (request: Request, backend: LayoutBackend, id: string) => Promise<Response>;
};

const RESOURCE_CONFIGS: ResourceConfig[] = [
  {
    name: 'layouts',
    storagePrefix: '',
    handleGet: handleScreenGet,
    handlePut: handleScreenPut,
    handleDelete: handleScreenDelete,
    handleRename: handleScreenRename,
  },
];

const isNavigationRequest = (request: Request): boolean => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('text/html');
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const backend = createLayoutsBackend(env);

    // layouts-specific: component sub-resources
    const componentMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/components\/(.+)$/);
    if (componentMatch) {
      const screenId = decodeURIComponent(componentMatch[1]);
      const componentId = decodeURIComponent(componentMatch[2]);
      if (request.method === 'GET') return handleComponentGet(backend, screenId, componentId);
      if (request.method === 'PUT') return handleComponentPut(request, backend, screenId, componentId);
      if (request.method === 'DELETE') return handleComponentDelete(backend, screenId, componentId);
      return new Response('Method Not Allowed', { status: 405 });
    }

    // layouts-specific: sub json-files listing
    const jsonFilesSubMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/json-files$/);
    if (jsonFilesSubMatch) {
      const screenId = decodeURIComponent(jsonFilesSubMatch[1]);
      if (request.method === 'GET') {
        const prefix = url.searchParams.get('prefix') ?? 'components/';
        return handleJsonFilesGet(backend, screenId, prefix);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // generic: list resource items
    const resourceJsonFilesMatch = url.pathname.match(/^\/api\/([^/]+)\/json-files$/);
    if (resourceJsonFilesMatch) {
      const config = RESOURCE_CONFIGS.find((c) => c.name === decodeURIComponent(resourceJsonFilesMatch[1]));
      if (!config) return new Response('Not Found', { status: 404 });
      if (request.method === 'GET') return handleResourceListGet(backend, config.storagePrefix);
      return new Response('Method Not Allowed', { status: 405 });
    }

    // generic: rename resource item
    const resourceRenameMatch = url.pathname.match(/^\/api\/([^/]+)\/([^/]+)\/rename$/);
    if (resourceRenameMatch) {
      const config = RESOURCE_CONFIGS.find((c) => c.name === decodeURIComponent(resourceRenameMatch[1]));
      if (!config) return new Response('Not Found', { status: 404 });
      const id = decodeURIComponent(resourceRenameMatch[2]);
      if (request.method === 'POST') {
        return config.handleRename
          ? config.handleRename(request, backend, id)
          : handleResourceRename(request, backend, config.storagePrefix, id);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // generic: CRUD on resource item
    const resourceItemMatch = url.pathname.match(/^\/api\/([^/]+)\/([^/]+)$/);
    if (resourceItemMatch) {
      const config = RESOURCE_CONFIGS.find((c) => c.name === decodeURIComponent(resourceItemMatch[1]));
      if (!config) return new Response('Not Found', { status: 404 });
      const id = decodeURIComponent(resourceItemMatch[2]);
      if (request.method === 'GET') {
        return config.handleGet
          ? config.handleGet(backend, id)
          : handleResourceGet(backend, config.storagePrefix, id);
      }
      if (request.method === 'PUT') {
        return config.handlePut
          ? config.handlePut(request, backend, id)
          : handleResourcePut(request, backend, config.storagePrefix, id);
      }
      if (request.method === 'DELETE') {
        return config.handleDelete
          ? config.handleDelete(backend, id)
          : handleResourceDelete(backend, config.storagePrefix, id);
      }
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
