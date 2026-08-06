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
import { readIdentity } from '../session/identity';
import { readGitHubConnectSession } from '../identify';


type Env = {
  readonly ASSETS: {
        fetch(request: Request): Promise<Response>;
  };
  readonly LOG_LEVEL?: string;
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
              frame.source = { url: `/api/v1/trees/${newTreeId}`, itemsPath: 'nodes' };
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

const resolveSecretValue = async (v: string | { get(): Promise<string> } | undefined): Promise<string | undefined> => {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  return v.get();
};

export const handleApiRequest = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  const backend = createLayoutsBackend(env);

  // Build-token auth: x-build-token header (for CI screen generation); org resolved from DEFAULT_ORG_ID
  const buildToken = request.headers.get('x-build-token');
  const expectedToken = await resolveSecretValue(env.BUILD_SCREENS_TOKEN);
  const isBuildRequest = buildToken && expectedToken && buildToken === expectedToken;

  const identity = await readIdentity(env, request);
  const tenantContext = isBuildRequest
    ? {
        tenantId: request.headers.get('x-org-id') ?? env.DEFAULT_ORG_ID ?? identity?.groupId,
        subjectId: undefined,
      }
    : {
        tenantId: identity?.groupId,
        subjectId: identity?.userId,
      };
  const screenNames = createScreenNameBackend(env, tenantContext);

  if (url.pathname === '/api/v1/component-schemas') {
    if (request.method === 'GET') {
      if (url.searchParams.get('format') === 'tree') return handleComponentSchemasTree(backend);
      return handleComponentSchemasList(backend, url.searchParams);
    }
    return new Response('Method Not Allowed', { status: 405 });
  }

  const dbApplyMatch = url.pathname.match(/^\/api\/v1\/admin\/db-apply\/(.+)$/);
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
      actorType: 'program',
      roles: ['ops'],
    });
  }

  if (url.pathname === '/api/v1/admin/migration/schema' && request.method === 'POST') {
    const body = await request.text();
    return authorizeFetch(env, {
      path: '/api/v1/admin/migration/schema',
      method: 'POST',
      body,
      tenantContext,
      actorType: 'program',
      roles: ['ops'],
    });
  }

  if (url.pathname === '/api/v1/admin/migration/table' && request.method === 'POST') {
    const body = await request.text();
    return authorizeFetch(env, {
      path: '/api/v1/admin/migration/table',
      method: 'POST',
      body,
      tenantContext,
      actorType: 'program',
      roles: ['ops'],
    });
  }

  if (url.pathname === '/api/v1/admin/migration/user-databases' && request.method === 'POST') {
    const body = await request.text();
    return authorizeFetch(env, {
      path: '/api/v1/admin/migration/user-databases',
      method: 'POST',
      body,
      tenantContext,
      actorType: 'program',
      roles: ['ops'],
    });
  }

  if (url.pathname === '/api/v1/admin/migration/r2' && request.method === 'POST') {
    const body = await request.text();
    return authorizeFetch(env, {
      path: '/api/v1/admin/migration/r2',
      method: 'POST',
      body,
      tenantContext,
      actorType: 'program',
      roles: ['ops'],
    });
  }

  if (url.pathname === '/api/v1/admin/migration/r2-layouts' && request.method === 'POST') {
    const body = await request.text();
    return authorizeFetch(env, {
      path: '/api/v1/admin/migration/r2-layouts',
      method: 'POST',
      body,
      tenantContext,
      actorType: 'program',
      roles: ['ops'],
    });
  }

  if (url.pathname === '/api/v1/admin/migration/identity' && request.method === 'POST') {
    const body = await request.text();
    return authorizeFetch(env, {
      path: '/api/v1/admin/migration/identity',
      method: 'POST',
      body,
      tenantContext,
      actorType: 'program',
      roles: ['ops'],
    });
  }

  if (url.pathname === '/api/v1/migrate/lists-to-tree') {
    if (request.method === 'POST') return handleMigrateListsToTree(backend);
    return new Response('Method Not Allowed', { status: 405 });
  }

  if (url.pathname === '/api/v1/migrate/screens-to-folder') {
    if (request.method === 'POST') return handleMigrateScreensToFolder(backend, screenNames);
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Storage Explorer: D1 proxy
  if (url.pathname === '/api/v1/viewer/d1/databases' && request.method === 'GET') {
    const identity = await readIdentity(env, request);
    const tenantContext = {
      tenantId: identity?.groupId,
      subjectId: identity?.userId,
    };
    return authorizeFetch(env, { path: '/api/v1/d1/v4/databases', method: 'GET', tenantContext });
  }

  const d1QueryMatch = url.pathname.match(/^\/api\/v1\/viewer\/d1\/([^/]+)\/query$/);
  if (d1QueryMatch && request.method === 'POST') {
    const dbId = decodeURIComponent(d1QueryMatch[1]);
    const body = await request.text();
    const identity = await readIdentity(env, request);
    const tenantContext = {
      tenantId: identity?.groupId,
      subjectId: identity?.userId,
    };
    return authorizeFetch(env, {
      path: `/api/v1/d1/v4/databases/${dbId}/query`,
      method: 'POST',
      body,
      tenantContext,
    });
  }

  // Storage Explorer: R2 proxy
  if (url.pathname === '/api/v1/viewer/r2/buckets' && request.method === 'GET') {
    const identity = await readIdentity(env, request);
    const tenantContext = {
      tenantId: identity?.groupId,
      subjectId: identity?.userId,
    };
    return authorizeFetch(env, {
      path: '/api/v1/cloudflare-r2-adapter/control/r2_bucket_list',
      method: 'POST',
      body: '{}',
      tenantContext,
    });
  }

  if (url.pathname === '/api/v1/viewer/r2/files' && request.method === 'POST') {
    const body = await request.text();
    const identity = await readIdentity(env, request);
    const tenantContext = {
      tenantId: identity?.groupId,
      subjectId: identity?.userId,
    };
    return authorizeFetch(env, {
      path: '/api/v1/cloudflare-r2-adapter/s3/r2_file_list',
      method: 'POST',
      body,
      tenantContext,
    });
  }

  if (url.pathname === '/api/v1/viewer/r2/file' && request.method === 'POST') {
    const body = await request.text();
    const identity = await readIdentity(env, request);
    const tenantContext = {
      tenantId: identity?.groupId,
      subjectId: identity?.userId,
    };
    return authorizeFetch(env, {
      path: '/api/v1/cloudflare-r2-adapter/s3/r2_file_get',
      method: 'POST',
      body,
      tenantContext,
    });
  }

  // 家計簿 API — backend の /api/v1/kakeibo/* (KakeiboDO) へ中継する。
  // graph と同じくテナント／実行者ごとのデータなので、識別子が欠けたまま転送しない。
  const kakeiboApiMatch = url.pathname.match(/^\/api\/v1\/kakeibo(\/.*)?$/);
  if (kakeiboApiMatch) {
    const suffix = kakeiboApiMatch[1] ?? '/';
    const backendPath = `/api/v1/kakeibo${suffix}${url.search}`;
    const body = request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined;
    const identity = await readIdentity(env, request);
    const tenantContext = { tenantId: identity?.groupId, subjectId: identity?.userId };
    // タブを開いたままセッションが切れた場合、テナント無しで転送すると空テナントに対する
    // 操作になって取り込みが黙って消える。401 を返してログインし直しを促す。
    if (!tenantContext.tenantId || !tenantContext.subjectId) {
      return Response.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const res = await authorizeFetch(env, { path: backendPath, method: request.method, body, tenantContext });
    if (env.LOG_LEVEL === 'debug') console.log(`[kakeibo-proxy] ${request.method} ${backendPath} → ${res.status}`);
    return res;
  }

  // ショサイ API — backend の /api/v1/shosai/* (ShosaiDO) へ中継する。
  // kakeibo / graph と同型。テナント／実行者ごとのデータなので、識別子が欠けたまま転送しない。
  const shosaiApiMatch = url.pathname.match(/^\/api\/v1\/shosai(\/.*)?$/);
  if (shosaiApiMatch) {
    const suffix = shosaiApiMatch[1] ?? '/';
    const backendPath = `/api/v1/shosai${suffix}${url.search}`;
    // 画像などのバイナリを text() で読むと UTF-8 として解釈されて壊れる。
    // 中身の型に応じて読み分け、Content-Type もそのまま渡す。
    const contentType = request.headers.get('Content-Type') ?? '';
    const isTextBody = contentType === '' || contentType.includes('json') || contentType.startsWith('text/');
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const body = hasBody
      ? (isTextBody ? await request.text() : await request.arrayBuffer())
      : undefined;
    const identity = await readIdentity(env, request);
    const tenantContext = { tenantId: identity?.groupId, subjectId: identity?.userId };
    if (!tenantContext.tenantId || !tenantContext.subjectId) {
      return Response.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const res = await authorizeFetch(env, {
      path: backendPath, method: request.method, body, tenantContext,
      ...(hasBody && !isTextBody ? { headers: { 'Content-Type': contentType } } : {}),
    });
    if (env.LOG_LEVEL === 'debug') console.log(`[shosai-proxy] ${request.method} ${backendPath} → ${res.status}`);
    return res;
  }

  // D1-backed graph API — proxy to backend /api/v1/graph/*
  const graphApiMatch = url.pathname.match(/^\/api\/v1\/graph(\/.*)?$/);
  if (graphApiMatch) {
    const suffix = graphApiMatch[1] ?? '/';
    const backendPath = `/api/v1/graph${suffix}${url.search}`;
    const body = request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined;
    const identity = await readIdentity(env, request);
    const tenantContext = {
      tenantId: identity?.groupId,
      subjectId: identity?.userId,
    };
    // The graph API is per-tenant/per-subject. If the session expired while the tab stayed open,
    // the identity cookies are gone; forwarding a tenant-less request makes the backend no-op on an
    // empty tenant and the write silently vanishes. Return 401 so the client surfaces a login notice
    // instead of losing the operation. (Page loads are already auth-gated, so an authenticated user
    // always carries both cookies here.)
    if (!tenantContext.tenantId || !tenantContext.subjectId) {
      return Response.json({ error: 'unauthenticated' }, { status: 401 });
    }
    try {
      const res = await authorizeFetch(env, { path: backendPath, method: request.method, body, tenantContext });
      if (env.LOG_LEVEL === 'debug') console.log(`[graph-proxy] ${request.method} ${backendPath} → ${res.status}`);
      return res;
    } catch (e) {
      console.error(`[graph-proxy] ${request.method} ${backendPath} threw:`, e);
      throw e;
    }
  }

  // Uranai: 地名→緯度経度のジオコーディング（外部 Nominatim）。バックエンドではなく front で完結。
  // 注: Nominatim は利用ポリシー/レート制限あり。将来は自前ジオコーダ/キャッシュに置換する。
  if (url.pathname === '/api/v1/uranai/geocode' && request.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim();
    if (!q) return Response.json({ results: [] }, { status: 200 });
    const nomi = new URL('https://nominatim.openstreetmap.org/search');
    nomi.searchParams.set('q', q);
    nomi.searchParams.set('format', 'json');
    nomi.searchParams.set('limit', '6');
    nomi.searchParams.set('accept-language', 'ja');
    nomi.searchParams.set('addressdetails', '1');
    type NomiAddr = Record<string, string>;
    try {
      const res = await fetch(nomi.toString(), { headers: { 'User-Agent': 'uranai.tachiiri.com/1.0 (astro chart)' } });
      const arr = res.ok ? ((await res.json()) as Array<{ display_name: string; lat: string; lon: string; address?: NomiAddr; name?: string; addresstype?: string }>) : [];
      // 構造化住所から「都道府県＋（郡）＋市区町村＋以下」を日本語順（例: 東京都渋谷区…）で組み立てる。
      // 「北海道地方」等の region、「石狩振興局」等の振興局/支庁（county だが末尾が郡でない）は住所に書かないので除外。
      // 特別区（例: 渋谷区）は state が入らず ISO3166-2-lvl4="JP-13" で都道府県が示される。ISO から補完する。
      const JP_PREF: Record<string, string> = {
        '01': '北海道', '02': '青森県', '03': '岩手県', '04': '宮城県', '05': '秋田県', '06': '山形県', '07': '福島県',
        '08': '茨城県', '09': '栃木県', '10': '群馬県', '11': '埼玉県', '12': '千葉県', '13': '東京都', '14': '神奈川県',
        '15': '新潟県', '16': '富山県', '17': '石川県', '18': '福井県', '19': '山梨県', '20': '長野県', '21': '岐阜県',
        '22': '静岡県', '23': '愛知県', '24': '三重県', '25': '滋賀県', '26': '京都府', '27': '大阪府', '28': '兵庫県',
        '29': '奈良県', '30': '和歌山県', '31': '鳥取県', '32': '島根県', '33': '岡山県', '34': '広島県', '35': '山口県',
        '36': '徳島県', '37': '香川県', '38': '愛媛県', '39': '高知県', '40': '福岡県', '41': '佐賀県', '42': '長崎県',
        '43': '熊本県', '44': '大分県', '45': '宮崎県', '46': '鹿児島県', '47': '沖縄県',
      };
      const prefFromISO = (a: NomiAddr): string => {
        const m = /^JP-(\d{2})$/.exec(a['ISO3166-2-lvl4'] || a['ISO3166-2-lvl3'] || '');
        return m ? (JP_PREF[m[1]] ?? '') : '';
      };
      const jpAddr = (a: NomiAddr | undefined): string => {
        if (!a) return '';
        const seen = new Set<string>(), out: string[] = [];
        const push = (v?: string) => { if (v && !seen.has(v)) { seen.add(v); out.push(v); } };
        push(a.state || a.province || prefFromISO(a));
        if (a.county && /郡$/.test(a.county)) push(a.county);
        push(a.city || a.town || a.village || a.municipality);
        push(a.city_district || a.borough || a.ward);
        push(a.suburb); push(a.quarter); push(a.neighbourhood);
        push(a.road);
        if (a.house_number) push(a.house_number);
        return out.join('');
      };
      // 構造化住所が空なら display_name（「詳細,…,国」順）を逆順連結でフォールバック。
      const fromDisplay = (displayName: string): string =>
        String(displayName ?? '').split(',').map((s) => s.trim())
          .filter((s) => s && s !== '日本' && s !== 'Japan' && !/^〒?\d{3}-?\d{0,4}$/.test(s))
          .reverse().join('');
      // 行政地名（市区町村）は住所に含まれるので地名を別出ししない。ランドマーク/駅等の POI 名は
      // 住所に出てこないので「地名」として別に載せる（例: 松本城（長野県松本市丸の内））。
      const ADMIN_TYPES = new Set(['country', 'state', 'province', 'county', 'city', 'town', 'village', 'municipality', 'city_district', 'borough', 'suburb', 'ward', 'district', 'administrative', 'postcode']);
      return Response.json({
        results: arr.map((r) => {
          const addr = jpAddr(r.address) || fromDisplay(r.display_name) || r.display_name;
          const nm = String(r.name ?? '').trim();
          // POI（非行政）で、かつ住所文字列にまだ含まれていない地名だけを別出しする。
          const place = nm && !ADMIN_TYPES.has(String(r.addresstype ?? '')) && !addr.includes(nm) ? nm : '';
          const name = place ? `${place}（${addr}）` : addr;
          const cc = String(r.address?.country_code ?? '').toLowerCase(); // 国コード（タイムゾーン既定推定用）
          return { name, place, addr, lat: Number(r.lat), lng: Number(r.lon), cc };
        }),
      }, { status: 200 });
    } catch {
      return Response.json({ results: [] }, { status: 200 });
    }
  }

  // Uranai per-tenant API — proxy to backend /api/v1/uranai/* (graph と同型)。
  const uranaiApiMatch = url.pathname.match(/^\/api\/v1\/uranai(\/.*)?$/);
  if (uranaiApiMatch) {
    const suffix = uranaiApiMatch[1] ?? '/';
    const backendPath = `/api/v1/uranai${suffix}${url.search}`;
    const body = request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined;
    const identity = await readIdentity(env, request);
    const tenantContext = { tenantId: identity?.groupId, subjectId: identity?.userId };
    if (!tenantContext.tenantId || !tenantContext.subjectId) {
      return Response.json({ error: 'unauthenticated' }, { status: 401 });
    }
    return authorizeFetch(env, { path: backendPath, method: request.method, body, tenantContext });
  }

  const treesMatch = url.pathname.match(/^\/api\/v1\/trees\/(.+)$/);
  if (treesMatch) {
    const treeId = decodeURIComponent(treesMatch[1]);
    if (request.method === 'GET') {
      if (url.searchParams.get('include_docs') === 'true') return handleTreeWithDocsGet(backend, treeId);
      return handleResourceGet(backend, 'trees/', treeId);
    }
    if (request.method === 'PUT') return handleResourcePut(request, backend, 'trees/', treeId);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const canvasOptionsMatch = url.pathname.match(/^\/api\/v1\/layouts\/([^/]+)\/canvases$/);
  if (canvasOptionsMatch) {
    const screenName = decodeURIComponent(canvasOptionsMatch[1]);
    const storageId = await resolveScreenStorageId(backend, screenNames, screenName);
    if (!storageId) return new Response('Not Found', { status: 404 });
    if (request.method === 'GET') return handleCanvasOptionsGet(backend, storageId);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const componentSchemaDefinitionMatch =
    url.pathname.match(/^\/api\/v1\/component-schemas\/(.+)\/definition$/);
  if (componentSchemaDefinitionMatch) {
    const kind = decodeURIComponent(componentSchemaDefinitionMatch[1]);
    if (request.method === 'GET') return handleComponentSchemaDefinitionGet(backend, kind);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const componentSchemaMatch = url.pathname.match(/^\/api\/v1\/component-schemas\/(.+)$/);
  if (componentSchemaMatch) {
    const kind = decodeURIComponent(componentSchemaMatch[1]);
    if (request.method === 'GET') return handleComponentSchemaGet(backend, kind);
    if (request.method === 'PUT') return handleComponentSchemaPut(request, backend, kind);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const componentMatch = url.pathname.match(/^\/api\/v1\/layouts\/([^/]+)\/components\/(.+)$/);
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

  const jsonFilesSubMatch = url.pathname.match(/^\/api\/v1\/layouts\/([^/]+)\/json-files$/);
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

  if (url.pathname === '/api/v1/layouts/json-files') {
    if (request.method === 'GET') return handleScreensListGet(screenNames);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const layoutsRenameMatch = url.pathname.match(/^\/api\/v1\/layouts\/([^/]+)\/rename$/);
  if (layoutsRenameMatch) {
    const name = decodeURIComponent(layoutsRenameMatch[1]);
    if (request.method === 'POST') return handleScreenRename(request, backend, screenNames, name);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const layoutsItemMatch = url.pathname.match(/^\/api\/v1\/layouts\/([^/]+)$/);
  if (layoutsItemMatch) {
    const name = decodeURIComponent(layoutsItemMatch[1]);
    if (request.method === 'GET') return handleScreenGet(backend, screenNames, name);
    if (request.method === 'PUT') return handleScreenPut(request, backend, screenNames, name);
    if (request.method === 'DELETE') return handleScreenDelete(backend, screenNames, name);
    return new Response('Method Not Allowed', { status: 405 });
  }

  const resourceRenameMatch = url.pathname.match(/^\/api\/v1\/([^/]+)\/([^/]+)\/rename$/);
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

  const resourceItemMatch = url.pathname.match(/^\/api\/v1\/([^/]+)\/([^/]+)$/);
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
    return new Response('<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><script type="module" src="/client.js"></script></body></html>', {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  }

  return env.ASSETS.fetch(request);
};
