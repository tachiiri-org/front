import { createLayoutsBackend, createScreenNameBackend, type LayoutsEnv, type LayoutBackend, type ScreenNameBackend } from '../web/storage/layouts/r2';
import { isScreen, isCanvasFrame } from '../web/schema/screen/screen';
import { getEntityDisplayName } from '../web/schema/component/name';
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
} from '../web/storage/layouts/http';
import {
  handleComponentSchemasList,
  handleComponentSchemasTree,
  handleComponentSchemaDefinitionGet,
  handleComponentSchemaGet,
  handleComponentSchemaPut,
} from './component-schemas';
import { authorizeFetch, type AuthorizeEnv } from '../session';
import { parseCookies } from '../session/cookies';
import { readGitHubConnectSession } from '../identify';


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

const RESOURCE_CONFIGS: ResourceConfig[] = [];

// --- Doc helpers ---

type DocTreeNode = { id: string; status?: string; type?: string; text?: string; children?: DocTreeNode[] };

const getDocStatus = (nodes: DocTreeNode[]): string => {
  let hasProposed = false;
  for (const node of nodes) {
    if (node.type === 'issue' || node.text?.startsWith('?')) return 'issue';
    if (node.status === 'proposed') hasProposed = true;
    if (node.children?.length) {
      const childStatus = getDocStatus(node.children);
      if (childStatus === 'issue') return 'issue';
      if (childStatus === 'proposed') hasProposed = true;
    }
  }
  return hasProposed ? 'proposed' : '1';
};

const handleTreeWithDocsGet = async (backend: LayoutBackend, treeId: string): Promise<Response> => {
  const treeBody = await backend.getText(`trees/${treeId}.json`);
  if (!treeBody) return new Response('Not Found', { status: 404 });

  type TreeNodeFull = { id: string; children?: TreeNodeFull[] };
  const collectIds = (list: TreeNodeFull[]): string[] => {
    const ids: string[] = [];
    for (const n of list) {
      ids.push(n.id);
      if (n.children?.length) ids.push(...collectIds(n.children));
    }
    return ids;
  };

  let tree: { nodes: TreeNodeFull[] };
  try {
    tree = JSON.parse(treeBody) as { nodes: TreeNodeFull[] };
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const allIds = collectIds(tree.nodes ?? []);
  const docEntries = await Promise.all(
    allIds.map(async (id) => {
      try {
        const body = await backend.getText(`trees/${id}.json`);
        if (!body) return null;
        const parsed = JSON.parse(body) as unknown;
        const nodes = (parsed as Record<string, unknown>)?.nodes;
        return Array.isArray(nodes) && nodes.length > 0
          ? ([id, getDocStatus(nodes as DocTreeNode[])] as [string, string])
          : null;
      } catch {
        return null;
      }
    }),
  );

  const docs = Object.fromEntries(docEntries.filter((e): e is [string, string] => e !== null));
  return new Response(JSON.stringify({ ...tree, docs }), { headers: { 'Content-Type': 'application/json' } });
};

// --- Migration helpers ---

type KnowledgeNode = {
  id: string;
  text: string;
  children?: KnowledgeNode[];
  status?: string;
  type?: string;
};

type DocNode = { id: string; text: string; children?: DocNode[] };
type GraphWord = { id: string; text: string };
type GraphText = { id: string; text: string; wordIds: string[] };

const flattenKnowledgeNodes = (nodes: KnowledgeNode[]): KnowledgeNode[] => {
  const result: KnowledgeNode[] = [];
  for (const n of nodes) {
    result.push(n);
    if (n.children?.length) result.push(...flattenKnowledgeNodes(n.children));
  }
  return result;
};

const flattenDocNodes = (nodes: DocNode[]): DocNode[] => {
  const result: DocNode[] = [];
  for (const n of nodes) {
    if (n.text?.trim()) result.push(n);
    if (n.children?.length) result.push(...flattenDocNodes(n.children));
  }
  return result;
};

const handleMigrateKnowledgeToWordGraph = async (
  backend: LayoutBackend,
  knowledgeTreeId: string,
  wordGraphId: string,
): Promise<Response> => {
  const knowledgeBody = await backend.getText(`trees/${knowledgeTreeId}.json`);
  if (!knowledgeBody) return new Response('Knowledge tree not found', { status: 404 });

  let knowledgeTree: { nodes: KnowledgeNode[] };
  try {
    knowledgeTree = JSON.parse(knowledgeBody) as { nodes: KnowledgeNode[] };
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const allKnowledgeNodes = flattenKnowledgeNodes(knowledgeTree.nodes ?? []);
  const words: GraphWord[] = [];
  const texts: GraphText[] = [];

  for (const kNode of allKnowledgeNodes) {
    if (!kNode.text?.trim()) continue;

    const docBody = await backend.getText(`trees/${kNode.id}.json`);
    if (!docBody) continue;

    let doc: { nodes: DocNode[] };
    try {
      doc = JSON.parse(docBody) as { nodes: DocNode[] };
    } catch {
      continue;
    }

    if (!doc.nodes?.length) continue;

    words.push({ id: kNode.id, text: kNode.text });

    for (const dn of flattenDocNodes(doc.nodes)) {
      texts.push({ id: crypto.randomUUID(), text: dn.text, wordIds: [kNode.id] });
    }
  }

  await backend.putText(
    `word-graphs/${wordGraphId}.json`,
    JSON.stringify({ texts, words }),
  );

  return new Response(JSON.stringify({ words: words.length, texts: texts.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

type TreeNode = { id: string; text: string; children?: TreeNode[] };
type ListRegistryEntry = { id: string; name: string };

const isRegistryEntry = (v: unknown): v is ListRegistryEntry => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return typeof c.id === 'string' && typeof c.name === 'string';
};

const handleMigrateListsToTree = async (backend: LayoutBackend): Promise<Response> => {
  // 1. Load list registry
  const registryText = await backend.getText('list/_registry.json');
  if (!registryText) {
    return new Response(JSON.stringify({ treeId: null, nodeCount: 0, message: 'Nothing to migrate' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let registry: ListRegistryEntry[] = [];
  try {
    const parsed = JSON.parse(registryText) as unknown;
    if (Array.isArray(parsed)) registry = parsed.filter(isRegistryEntry);
  } catch { /* fall through */ }

  if (registry.length === 0) {
    return new Response(JSON.stringify({ treeId: null, nodeCount: 0, message: 'Nothing to migrate' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. For each registry entry, load tree nodes from trees/${name}.json
  const mergedNodes: TreeNode[] = [];
  for (const entry of registry) {
    const treeText = await backend.getText(`trees/list/${entry.name}.json`);
    let treeNodes: TreeNode[] | undefined;
    if (treeText) {
      try {
        const parsed = JSON.parse(treeText) as unknown;
        const nodes = (parsed as Record<string, unknown>).nodes;
        if (Array.isArray(nodes)) treeNodes = nodes as TreeNode[];
      } catch { /* fall through */ }
    }
    mergedNodes.push({
      id: crypto.randomUUID(),
      text: entry.name,
      children: treeNodes && treeNodes.length > 0 ? treeNodes : undefined,
    });
  }

  // 3. Save merged tree to trees/${newUUID}.json
  const newTreeId = crypto.randomUUID();
  await backend.putText(`trees/${newTreeId}.json`, JSON.stringify({ nodes: mergedNodes }));

  // 4. Update screens that reference api/list
  const screenRegistryText = await backend.getText('_registry.json');
  if (screenRegistryText) {
    try {
      const parsed = JSON.parse(screenRegistryText) as unknown;
      if (Array.isArray(parsed)) {
        const screenEntries = parsed.filter(isRegistryEntry);
        for (const screen of screenEntries) {
          const screenText = await backend.getText(`${screen.id}.json`);
          if (!screenText) continue;
          try {
            const screenData = JSON.parse(screenText) as Record<string, unknown>;
            const frames = screenData.frames;
            if (!Array.isArray(frames)) continue;
            let changed = false;
            for (const frame of frames as Record<string, unknown>[]) {
              if (frame.kind !== 'outliner') continue;
              const src = frame.source as Record<string, unknown> | undefined;
              if (!src || typeof src.url !== 'string') continue;
              if (!src.url.includes('api/list') && !src.url.includes('component-schemas')) continue;
              frame.source = { url: `/api/trees/${newTreeId}`, itemsPath: 'nodes' };
              changed = true;
            }
            if (changed) {
              await backend.putText(`screens/${screen.id}.json`, JSON.stringify(screenData));
            }
          } catch { /* fall through */ }
        }
      }
    } catch { /* fall through */ }
  }

  // 5. Delete all files under list/ prefix
  let cursor: string | undefined;
  do {
    const result = await backend.list('list/', cursor);
    for (const object of result.objects) {
      await backend.deleteKey(object.key);
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);

  // 6. Delete old per-list tree files
  for (const entry of registry) {
    await backend.deleteKey(`trees/list/${entry.name}.json`);
  }

  // 7. Return result
  return new Response(JSON.stringify({ treeId: newTreeId, nodeCount: mergedNodes.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

const handleMigrateScreensToFolder = async (
  backend: LayoutBackend,
  screenNames: ScreenNameBackend,
): Promise<Response> => {
  const REGISTRY_KEY = '_registry.json';
  const registryText = await backend.getText(REGISTRY_KEY);
  if (!registryText) {
    return new Response(JSON.stringify({ migrated: 0, message: 'No _registry.json found' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  type Entry = { id: string; name: string };
  let entries: Entry[] = [];
  try {
    const parsed = JSON.parse(registryText) as unknown;
    if (Array.isArray(parsed)) {
      entries = (parsed as unknown[]).filter((e): e is Entry =>
        typeof e === 'object' && e !== null &&
        typeof (e as Record<string, unknown>).id === 'string' &&
        typeof (e as Record<string, unknown>).name === 'string'
      );
    }
  } catch { /* */ }

  const results: { id: string; name: string; status: string }[] = [];

  for (const entry of entries) {
    try {
      // Copy JSON to screens/ prefix
      const body = await backend.getText(`${entry.id}.json`);
      if (body) {
        await backend.putText(`screens/${entry.id}.json`, body);
      }
      // Copy components if any
      let cursor: string | undefined;
      do {
        const result = await backend.list(`${entry.id}/components/`, cursor);
        for (const obj of result.objects) {
          const file = await backend.getText(obj.key);
          if (file) await backend.putText(`screens/${obj.key}`, file);
        }
        cursor = result.truncated ? result.cursor : undefined;
      } while (cursor);
      // Register in D1
      await screenNames.create(entry.id, entry.name);
      results.push({ id: entry.id, name: entry.name, status: 'ok' });
    } catch (e) {
      results.push({ id: entry.id, name: entry.name, status: `error:${String(e)}` });
    }
  }

  // Delete old root files and _registry.json only if all succeeded
  const allOk = results.every((r) => r.status === 'ok');
  let cleanupError: string | null = null;
  if (allOk) {
    try {
      for (const entry of entries) {
        await backend.deleteKey(`${entry.id}.json`);
        let cursor: string | undefined;
        let result = await backend.list(`${entry.id}/components/`, cursor);
        while (result.objects.length > 0 || result.truncated) {
          for (const obj of result.objects) await backend.deleteKey(obj.key);
          if (!result.truncated) break;
          cursor = result.cursor;
          result = await backend.list(`${entry.id}/components/`, cursor);
        }
      }
      await backend.deleteKey(REGISTRY_KEY);
    } catch (e) {
      cleanupError = String(e);
    }
  }

  return new Response(JSON.stringify({ migrated: results.filter((r) => r.status === 'ok').length, allOk, cleanupError, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

const isNavigationRequest = (request: Request): boolean => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('text/html');
};

const handleCanvasOptionsGet = async (backend: LayoutBackend, screenId: string): Promise<Response> => {
  const body = await backend.getText(`screens/${screenId}.json`);
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
  const cookies = parseCookies(request);
  const tenantContext = {
    tenantId: cookies.get('identity_org_id') ?? undefined,
    subjectId: cookies.get('identity_user_id') ?? undefined,
  };
  const screenNames = createScreenNameBackend(env, tenantContext);

  if (url.pathname === '/api/component-schemas') {
    if (request.method === 'GET') {
      if (url.searchParams.get('format') === 'tree') return handleComponentSchemasTree(backend);
      return handleComponentSchemasList(backend, url.searchParams);
    }
    return new Response('Method Not Allowed', { status: 405 });
  }

  const dbApplyMatch = url.pathname.match(/^\/api\/admin\/db-apply\/(.+)$/);
  if (dbApplyMatch) {
    const suffix = dbApplyMatch[1] + url.search;
    const body = request.method !== 'GET' ? await request.text() : undefined;
    const connectSession = await readGitHubConnectSession(request, env);
    const githubToken = connectSession?.accessToken ?? null;
    return authorizeFetch(env, {
      path: `/api/v1/admin/db-apply/${suffix}`,
      method: request.method,
      body,
      headers: githubToken ? { 'x-github-access-token': githubToken } : undefined,
      tenantContext,
      actorType: 'ops',
    });
  }

  if (url.pathname === '/api/admin/migration/schema' && request.method === 'POST') {
    const body = await request.text();
    return authorizeFetch(env, {
      path: '/api/v1/admin/migration/schema',
      method: 'POST',
      body,
      tenantContext,
      actorType: 'ops',
    });
  }

  if (url.pathname === '/api/admin/migration/table' && request.method === 'POST') {
    const body = await request.text();
    return authorizeFetch(env, {
      path: '/api/v1/admin/migration/table',
      method: 'POST',
      body,
      tenantContext,
      actorType: 'ops',
    });
  }

  if (url.pathname === '/api/admin/migration/user-databases' && request.method === 'POST') {
    const body = await request.text();
    return authorizeFetch(env, {
      path: '/api/v1/admin/migration/user-databases',
      method: 'POST',
      body,
      tenantContext,
      actorType: 'ops',
    });
  }

  if (url.pathname === '/api/admin/migration/r2' && request.method === 'POST') {
    const body = await request.text();
    return authorizeFetch(env, {
      path: '/api/v1/admin/migration/r2',
      method: 'POST',
      body,
      tenantContext,
      actorType: 'ops',
    });
  }

  if (url.pathname === '/api/admin/migration/r2-layouts' && request.method === 'POST') {
    const body = await request.text();
    return authorizeFetch(env, {
      path: '/api/v1/admin/migration/r2-layouts',
      method: 'POST',
      body,
      tenantContext,
      actorType: 'ops',
    });
  }

  if (url.pathname === '/api/admin/migration/identity' && request.method === 'POST') {
    const body = await request.text();
    return authorizeFetch(env, {
      path: '/api/v1/admin/migration/identity',
      method: 'POST',
      body,
      tenantContext,
      actorType: 'ops',
    });
  }

  if (url.pathname === '/api/migrate/lists-to-tree') {
    if (request.method === 'POST') return handleMigrateListsToTree(backend);
    return new Response('Method Not Allowed', { status: 405 });
  }

  if (url.pathname === '/api/migrate/screens-to-folder') {
    if (request.method === 'POST') return handleMigrateScreensToFolder(backend, screenNames);
    return new Response('Method Not Allowed', { status: 405 });
  }

  if (url.pathname === '/api/migrate/knowledge-to-word-graph') {
    if (request.method === 'POST') {
      const from = url.searchParams.get('from') ?? 'knowledge-1';
      const to = url.searchParams.get('to') ?? 'word-graph-1';
      return handleMigrateKnowledgeToWordGraph(backend, from, to);
    }
    return new Response('Method Not Allowed', { status: 405 });
  }

  const wordGraphsMatch = url.pathname.match(/^\/api\/word-graphs\/(.+)$/);
  if (wordGraphsMatch) {
    const graphId = decodeURIComponent(wordGraphsMatch[1]);
    if (request.method === 'GET') return handleResourceGet(backend, 'word-graphs/', graphId);
    if (request.method === 'PUT') return handleResourcePut(request, backend, 'word-graphs/', graphId);
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Storage Explorer: D1 proxy
  if (url.pathname === '/api/viewer/d1/databases' && request.method === 'GET') {
    const cookies = parseCookies(request);
    const tenantContext = {
      tenantId: cookies.get('identity_org_id') ?? undefined,
      subjectId: cookies.get('identity_user_id') ?? undefined,
    };
    return authorizeFetch(env, { path: '/api/v1/d1/v4/databases', method: 'GET', tenantContext });
  }

  const d1QueryMatch = url.pathname.match(/^\/api\/viewer\/d1\/([^/]+)\/query$/);
  if (d1QueryMatch && request.method === 'POST') {
    const dbId = decodeURIComponent(d1QueryMatch[1]);
    const body = await request.text();
    const cookies = parseCookies(request);
    const tenantContext = {
      tenantId: cookies.get('identity_org_id') ?? undefined,
      subjectId: cookies.get('identity_user_id') ?? undefined,
    };
    return authorizeFetch(env, {
      path: `/api/v1/d1/v4/databases/${dbId}/query`,
      method: 'POST',
      body,
      tenantContext,
    });
  }

  // Storage Explorer: R2 proxy
  if (url.pathname === '/api/viewer/r2/buckets' && request.method === 'GET') {
    const cookies = parseCookies(request);
    const tenantContext = {
      tenantId: cookies.get('identity_org_id') ?? undefined,
      subjectId: cookies.get('identity_user_id') ?? undefined,
    };
    return authorizeFetch(env, {
      path: '/api/v1/cloudflare-r2-adapter/control/r2_bucket_list',
      method: 'POST',
      body: '{}',
      tenantContext,
    });
  }

  if (url.pathname === '/api/viewer/r2/files' && request.method === 'POST') {
    const body = await request.text();
    const cookies = parseCookies(request);
    const tenantContext = {
      tenantId: cookies.get('identity_org_id') ?? undefined,
      subjectId: cookies.get('identity_user_id') ?? undefined,
    };
    return authorizeFetch(env, {
      path: '/api/v1/cloudflare-r2-adapter/s3/r2_file_list',
      method: 'POST',
      body,
      tenantContext,
    });
  }

  if (url.pathname === '/api/viewer/r2/file' && request.method === 'POST') {
    const body = await request.text();
    const cookies = parseCookies(request);
    const tenantContext = {
      tenantId: cookies.get('identity_org_id') ?? undefined,
      subjectId: cookies.get('identity_user_id') ?? undefined,
    };
    return authorizeFetch(env, {
      path: '/api/v1/cloudflare-r2-adapter/s3/r2_file_get',
      method: 'POST',
      body,
      tenantContext,
    });
  }

  // D1-backed graph API — proxy to backend /api/v1/graph/*
  const graphApiMatch = url.pathname.match(/^\/api\/graph\/(.+)$/);
  if (graphApiMatch) {
    const suffix = graphApiMatch[1];
    const backendPath = `/api/v1/graph/${suffix}${url.search}`;
    const body = request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined;
    const cookies = parseCookies(request);
    const tenantContext = {
      tenantId: cookies.get('identity_org_id') ?? undefined,
      subjectId: cookies.get('identity_user_id') ?? undefined,
    };
    try {
      const res = await authorizeFetch(env, { path: backendPath, method: request.method, body, tenantContext });
      console.log(`[graph-proxy] ${request.method} ${backendPath} → ${res.status}`);
      return res;
    } catch (e) {
      console.error(`[graph-proxy] ${request.method} ${backendPath} threw:`, e);
      throw e;
    }
  }

  const treesMatch = url.pathname.match(/^\/api\/trees\/(.+)$/);
  if (treesMatch) {
    const treeId = decodeURIComponent(treesMatch[1]);
    if (request.method === 'GET') {
      if (url.searchParams.get('include_docs') === 'true') return handleTreeWithDocsGet(backend, treeId);
      return handleResourceGet(backend, 'trees/', treeId);
    }
    if (request.method === 'PUT') return handleResourcePut(request, backend, 'trees/', treeId);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const canvasOptionsMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/canvases$/);
  if (canvasOptionsMatch) {
    const screenName = decodeURIComponent(canvasOptionsMatch[1]);
    const storageId = await resolveScreenStorageId(backend, screenNames, screenName);
    if (!storageId) return new Response('Not Found', { status: 404 });
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
    const storageId = await resolveScreenStorageId(backend, screenNames, screenName);
    if (!storageId) return new Response('Not Found', { status: 404 });
    if (request.method === 'GET') return handleComponentGet(backend, storageId, componentId);
    if (request.method === 'PUT') return handleComponentPut(request, backend, storageId, componentId);
    if (request.method === 'DELETE') return handleComponentDelete(backend, storageId, componentId);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const jsonFilesSubMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/json-files$/);
  if (jsonFilesSubMatch) {
    const screenName = decodeURIComponent(jsonFilesSubMatch[1]);
    const storageId = await resolveScreenStorageId(backend, screenNames, screenName);
    if (!storageId) return new Response('Not Found', { status: 404 });
    if (request.method === 'GET') {
      const prefix = url.searchParams.get('prefix') ?? 'components/';
      return handleJsonFilesGet(backend, storageId, prefix);
    }
    return new Response('Method Not Allowed', { status: 405 });
  }

  if (url.pathname === '/api/layouts/json-files') {
    if (request.method === 'GET') return handleScreensListGet(screenNames);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const layoutsRenameMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/rename$/);
  if (layoutsRenameMatch) {
    const name = decodeURIComponent(layoutsRenameMatch[1]);
    if (request.method === 'POST') return handleScreenRename(request, backend, screenNames, name);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const layoutsItemMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)$/);
  if (layoutsItemMatch) {
    const name = decodeURIComponent(layoutsItemMatch[1]);
    if (request.method === 'GET') return handleScreenGet(backend, screenNames, name);
    if (request.method === 'PUT') return handleScreenPut(request, backend, screenNames, name);
    if (request.method === 'DELETE') return handleScreenDelete(backend, screenNames, name);
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
