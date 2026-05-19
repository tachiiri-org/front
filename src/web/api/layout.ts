import { createLayoutsBackend, type LayoutsEnv, type LayoutBackend } from '../storage/layouts/r2';
import { isScreen, isCanvasFrame } from '../schema/screen/screen';
import { getEntityDisplayName } from '../schema/component/name';
import {
  handleComponentGet,
  handleJsonFilesGet,
  handleScreenGet,
  handleScreenPut,
  handleScreenDelete,
  handleScreenRename,
  handleScreensListGet,
  resolveScreenStorageId,
  handleComponentPut,
  handleComponentDelete,
  handleResourceListGet,
  handleResourceGet,
  handleResourcePut,
  handleResourceDelete,
  handleResourceRename,
} from '../storage/layouts/http';
import {
  handleComponentSchemasList,
  handleComponentSchemasTree,
  handleComponentSchemaDefinitionGet,
  handleComponentSchemaGet,
  handleComponentSchemaPut,
  handleListResourceListGet,
  handleListResourceGet,
  handleListResourcePut,
  handleListResourceDelete,
  handleListResourceRename,
} from './component-schemas';
import { type AuthorizeEnv } from '../../auth';

type Env = {
  readonly ASSETS: {
        fetch(request: Request): Promise<Response>;
  };
} & LayoutsEnv & AuthorizeEnv;

type ResourceConfig = {
  name: string;
  storagePrefix: string;
  handleList?: (backend: LayoutBackend) => Promise<Response>;
  handleGet?: (backend: LayoutBackend, id: string) => Promise<Response>;
  handlePut?: (request: Request, backend: LayoutBackend, id: string) => Promise<Response>;
  handleDelete?: (backend: LayoutBackend, id: string) => Promise<Response>;
  handleRename?: (request: Request, backend: LayoutBackend, id: string) => Promise<Response>;
  normalizeGet?: (backend: LayoutBackend, id: string, value: unknown) => Promise<unknown | null>;
  normalizePut?: (backend: LayoutBackend, id: string, value: unknown) => Promise<unknown | null>;
};

const RESOURCE_CONFIGS: ResourceConfig[] = [
  {
    name: 'layouts',
    storagePrefix: '',
    handleList: handleScreensListGet,
    handleGet: handleScreenGet,
    handlePut: handleScreenPut,
    handleDelete: handleScreenDelete,
    handleRename: handleScreenRename,
  },
  {
    name: 'list',
    storagePrefix: 'list/',
    handleList: handleListResourceListGet,
    handleGet: handleListResourceGet,
    handlePut: handleListResourcePut,
    handleDelete: handleListResourceDelete,
    handleRename: handleListResourceRename,
  },
];

const isNavigationRequest = (request: Request): boolean => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('text/html');
};

const handleCanvasOptionsGet = async (backend: LayoutBackend, screenId: string): Promise<Response> => {
  const body = await backend.getText(`${screenId}.json`);
  if (!body) return new Response('Not Found', { status: 404 });
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isScreen(parsed)) return new Response('Invalid screen', { status: 400 });
    const items = parsed.frames
      .filter(isCanvasFrame)
      .map((frame) => ({
        value: frame.id,
        label: getEntityDisplayName(frame as Record<string, unknown> & { id: string }),
      }));
    return new Response(JSON.stringify({ items }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
};

export const handleApiRequest = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  const backend = createLayoutsBackend(env);

  if (url.pathname === '/api/component-schemas') {
    if (request.method === 'GET') {
      if (url.searchParams.get('format') === 'tree') return handleComponentSchemasTree(backend);
      return handleComponentSchemasList(backend, url.searchParams);
    }
    return new Response('Method Not Allowed', { status: 405 });
  }

  const treesMatch = url.pathname.match(/^\/api\/trees\/(.+)$/);
  if (treesMatch) {
    const treeId = decodeURIComponent(treesMatch[1]);
    if (request.method === 'GET') return handleResourceGet(backend, 'trees/', treeId);
    if (request.method === 'PUT') return handleResourcePut(request, backend, 'trees/', treeId);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const docsMatch = url.pathname.match(/^\/api\/docs\/(.+)$/);
  if (docsMatch) {
    const docId = decodeURIComponent(docsMatch[1]);
    if (request.method === 'GET') {
      const body = await backend.getText(`docs/${docId}.json`);
      const responseBody = body ?? JSON.stringify({ content: '' });
      return new Response(responseBody, { headers: { 'Content-Type': 'application/json' } });
    }
    if (request.method === 'PUT') return handleResourcePut(request, backend, 'docs/', docId);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const canvasOptionsMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/canvases$/);
  if (canvasOptionsMatch) {
    const screenName = decodeURIComponent(canvasOptionsMatch[1]);
    const storageId = (await resolveScreenStorageId(backend, screenName)) ?? screenName;
    if (request.method === 'GET') return handleCanvasOptionsGet(backend, storageId);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const componentSchemaDefinitionMatch =
    url.pathname.match(/^\/api\/component-schemas\/(.+)\/definition$/);
  if (componentSchemaDefinitionMatch) {
    const kind = decodeURIComponent(componentSchemaDefinitionMatch[1]);
    if (request.method === 'GET') return handleComponentSchemaDefinitionGet(backend, kind);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const componentSchemaMatch = url.pathname.match(/^\/api\/component-schemas\/(.+)$/);
  if (componentSchemaMatch) {
    const kind = decodeURIComponent(componentSchemaMatch[1]);
    if (request.method === 'GET') return handleComponentSchemaGet(backend, kind);
    if (request.method === 'PUT') return handleComponentSchemaPut(request, backend, kind);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const componentMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/components\/(.+)$/);
  if (componentMatch) {
    const screenName = decodeURIComponent(componentMatch[1]);
    const componentId = decodeURIComponent(componentMatch[2]);
    const storageId = (await resolveScreenStorageId(backend, screenName)) ?? screenName;
    if (request.method === 'GET') return handleComponentGet(backend, storageId, componentId);
    if (request.method === 'PUT') return handleComponentPut(request, backend, storageId, componentId);
    if (request.method === 'DELETE') return handleComponentDelete(backend, storageId, componentId);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const jsonFilesSubMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/json-files$/);
  if (jsonFilesSubMatch) {
    const screenName = decodeURIComponent(jsonFilesSubMatch[1]);
    const storageId = (await resolveScreenStorageId(backend, screenName)) ?? screenName;
    if (request.method === 'GET') {
      const prefix = url.searchParams.get('prefix') ?? 'components/';
      return handleJsonFilesGet(backend, storageId, prefix);
    }
    return new Response('Method Not Allowed', { status: 405 });
  }

  const resourceJsonFilesMatch = url.pathname.match(/^\/api\/([^/]+)\/json-files$/);
  if (resourceJsonFilesMatch) {
    const resourceName = decodeURIComponent(resourceJsonFilesMatch[1]);
    const config = RESOURCE_CONFIGS.find((c) => c.name === resourceName);
    if (!config) return new Response('Not Found', { status: 404 });
    if (request.method === 'GET') {
      return config.handleList
        ? config.handleList(backend)
        : handleResourceListGet(backend, config.storagePrefix);
    }
    return new Response('Method Not Allowed', { status: 405 });
  }

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

  const resourceItemMatch = url.pathname.match(/^\/api\/([^/]+)\/([^/]+)$/);
  if (resourceItemMatch) {
    const config = RESOURCE_CONFIGS.find((c) => c.name === decodeURIComponent(resourceItemMatch[1]));
    if (!config) return new Response('Not Found', { status: 404 });
    const id = decodeURIComponent(resourceItemMatch[2]);
    if (request.method === 'GET') {
      return config.handleGet
        ? config.handleGet(backend, id)
        : handleResourceGet(backend, config.storagePrefix, id, config.normalizeGet);
    }
    if (request.method === 'PUT') {
      return config.handlePut
        ? config.handlePut(request, backend, id)
        : handleResourcePut(request, backend, config.storagePrefix, id, config.normalizePut);
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
};
