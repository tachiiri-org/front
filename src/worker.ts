import { isComponent, type Component, isFieldComponent } from './component';
import { isGridComponent } from './component/grid';
import { isSelectComponent } from './component/select';
import {
  isScreen,
  isGridLayout,
  isFrame,
  isPlacement,
  type Screen,
  type Frame,
  type Placement,
} from './screen';

type Env = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  readonly LAYOUTS: R2Bucket;
};

type ListItem = {
  value: string;
  label: string;
};

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === 'string');
};

const isMetaTag = (value: unknown): value is { name: string; content: string } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === 'string' && typeof candidate.content === 'string';
};

const isHeadLike = (value: unknown): value is Screen['head'] => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.meta) &&
    candidate.meta.every(isMetaTag)
  );
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

type FrameCandidate = { id: string; kind: string } & Record<string, unknown>;

const isFrameCandidate = (value: unknown): value is FrameCandidate => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === 'string' && typeof c.kind === 'string';
};

const deriveColumns = (frames: FrameCandidate[]): number =>
  Math.max(1, Math.ceil(Math.sqrt(Math.max(frames.length, 1))));

const cellKey = (x: number, y: number): string => `${x}:${y}`;

const occupiesCells = (placement: Placement): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let row = placement.y; row < placement.y + placement.height; row += 1) {
    for (let col = placement.x; col < placement.x + placement.width; col += 1) {
      cells.push([col, row]);
    }
  }
  return cells;
};

const collectOccupiedCells = (frames: Frame[]): Set<string> => {
  const occupied = new Set<string>();
  for (const frame of frames) {
    for (const [x, y] of occupiesCells(frame.placement)) {
      occupied.add(cellKey(x, y));
    }
  }
  return occupied;
};

const findNextPlacement = (occupied: Set<string>, columns: number): Placement => {
  for (let row = 1; ; row += 1) {
    for (let col = 1; col <= columns; col += 1) {
      const key = cellKey(col, row);
      if (occupied.has(key)) continue;
      occupied.add(key);
      return { x: col, y: row, width: 1, height: 1 };
    }
  }
};

const normalizeScreen = (value: unknown): Screen | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (!isHeadLike(candidate.head)) return null;
  if (!isStringRecord(candidate.shell)) return null;
  if (!Array.isArray(candidate.frames) || !candidate.frames.every(isFrameCandidate)) return null;

  const frames = candidate.frames as FrameCandidate[];
  const placedFrames = frames.filter((f) => isFrame(f)) as Frame[];
  const existingMaxColumn = placedFrames.reduce(
    (max, f) => Math.max(max, f.placement.x + f.placement.width - 1),
    1,
  );
  const inputGrid = isGridLayout(candidate.grid) ? candidate.grid : null;
  const columns = Math.max(inputGrid ? inputGrid.columns : deriveColumns(frames), existingMaxColumn);
  const rows = inputGrid?.rows;
  const occupied = collectOccupiedCells(placedFrames);

  const normalizedFrames = frames.map((frame) => {
    const p = (frame as Record<string, unknown>).placement;
    if (isPlacement(p) && isPositiveInteger((p as Placement).width) && isPositiveInteger((p as Placement).height)) {
      return frame as Frame;
    }
    return { ...frame, placement: findNextPlacement(occupied, columns) } as Frame;
  });

  const grid: Screen['grid'] = rows !== undefined
    ? { kind: 'grid', columns, rows }
    : { kind: 'grid', columns };

  const normalized: Screen = {
    head: candidate.head as Screen['head'],
    shell: candidate.shell as Record<string, string>,
    grid,
    frames: normalizedFrames,
  };

  return isScreen(normalized) ? normalized : null;
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
      const val = relative.slice(0, -'.json'.length);
      if (!seen.has(val)) seen.set(val, { value: val, label: val });
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);

  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
};

const isNavigationRequest = (request: Request): boolean => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('text/html');
};

const handleScreenGet = async (env: Env, id: string): Promise<Response> => {
  const object = await env.LAYOUTS.get(`${id}.json`);
  if (!object) return new Response('Not Found', { status: 404 });

  const body = await object.text();
  try {
    const value = JSON.parse(body) as unknown;
    const normalized = normalizeScreen(value);
    if (!normalized) return new Response('Invalid screen', { status: 400 });

    if (JSON.stringify(value) !== JSON.stringify(normalized)) {
      await env.LAYOUTS.put(`${id}.json`, JSON.stringify(normalized), {
        httpMetadata: { contentType: 'application/json' },
      });
    }

    return new Response(JSON.stringify(normalized), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
};

const handleScreensJsonFilesGet = async (env: Env): Promise<Response> => {
  const items = await buildJsonFileItems(env, '', { excludeNested: true });
  return new Response(JSON.stringify({ items }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

const handleComponentGet = async (env: Env, screenId: string, componentId: string): Promise<Response> => {
  const object = await env.LAYOUTS.get(`${screenId}/components/${componentId}.json`);
  if (!object) return new Response('Not Found', { status: 404 });
  return new Response(object.body, { headers: { 'Content-Type': 'application/json' } });
};

const handleJsonFilesGet = async (env: Env, screenId: string, prefix: string): Promise<Response> => {
  const items = await buildJsonFileItems(env, `${screenId}/${prefix}`);
  return new Response(JSON.stringify({ items }), { headers: { 'Content-Type': 'application/json' } });
};

const handleScreenPut = async (request: Request, env: Env, id: string): Promise<Response> => {
  const body = await request.text();
  try {
    const value = JSON.parse(body) as unknown;
    const normalized = normalizeScreen(value);
    if (!normalized) return new Response('Invalid screen', { status: 400 });
    await env.LAYOUTS.put(`${id}.json`, JSON.stringify(normalized), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  return new Response(null, { status: 204 });
};

const deleteScreenObjects = async (env: Env, screenId: string): Promise<void> => {
  await env.LAYOUTS.delete(`${screenId}.json`);
  let cursor: string | undefined;
  do {
    const result = await env.LAYOUTS.list({ prefix: `${screenId}/components/`, cursor });
    if (result.objects.length > 0) {
      await env.LAYOUTS.delete(result.objects.map((o) => o.key));
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
};

const handleScreenDelete = async (env: Env, id: string): Promise<Response> => {
  await deleteScreenObjects(env, id);
  return new Response(null, { status: 204 });
};

const handleScreenRename = async (request: Request, env: Env, id: string): Promise<Response> => {
  const body = await request.text();
  let to: string;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as Record<string, unknown>).to !== 'string') {
      return new Response('Invalid body', { status: 400 });
    }
    to = ((parsed as Record<string, unknown>).to as string).trim();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!to || to === id || to.includes('/')) return new Response('Invalid target name', { status: 400 });

  const source = await env.LAYOUTS.get(`${id}.json`);
  if (!source) return new Response('Not Found', { status: 404 });

  const existing = await env.LAYOUTS.get(`${to}.json`);
  if (existing) return new Response('Conflict', { status: 409 });

  await env.LAYOUTS.put(`${to}.json`, await source.text(), {
    httpMetadata: { contentType: 'application/json' },
  });

  const prefix = `${id}/components/`;
  let cursor: string | undefined;
  do {
    const result = await env.LAYOUTS.list({ prefix, cursor });
    for (const object of result.objects) {
      const file = await env.LAYOUTS.get(object.key);
      if (file) {
        await env.LAYOUTS.put(
          `${to}/components/${object.key.slice(prefix.length)}`,
          await file.arrayBuffer(),
          { httpMetadata: { contentType: 'application/json' } },
        );
      }
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);

  await deleteScreenObjects(env, id);
  return new Response(null, { status: 204 });
};

const handleComponentPut = async (
  request: Request,
  env: Env,
  screenId: string,
  componentId: string,
): Promise<Response> => {
  const body = await request.text();
  try {
    const value = JSON.parse(body) as unknown;
    if (!isComponent(value)) return new Response('Invalid component', { status: 400 });
    if (
      (value as Record<string, unknown>).kind === 'select' && !isSelectComponent(value) ||
      (value as Record<string, unknown>).kind === 'grid' && !isGridComponent(value)
    ) {
      return new Response('Invalid component', { status: 400 });
    }
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  await env.LAYOUTS.put(`${screenId}/components/${componentId}.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });
  return new Response(null, { status: 204 });
};

const handleComponentDelete = async (env: Env, screenId: string, componentId: string): Promise<Response> => {
  await env.LAYOUTS.delete(`${screenId}/components/${componentId}.json`);
  return new Response(null, { status: 204 });
};

const isComponentSchema = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return Array.isArray(c.fields) && (c.fields as unknown[]).every(isFieldComponent);
};

const handleSchemaGet = async (env: Env, kind: string): Promise<Response> => {
  const object = await env.LAYOUTS.get(`schemas/${kind}.json`);
  if (!object) return new Response('Not Found', { status: 404 });
  return new Response(object.body, { headers: { 'Content-Type': 'application/json' } });
};

const handleSchemaPut = async (request: Request, env: Env, kind: string): Promise<Response> => {
  const body = await request.text();
  try {
    const value = JSON.parse(body) as unknown;
    if (!isComponentSchema(value)) return new Response('Invalid schema', { status: 400 });
    await env.LAYOUTS.put(`schemas/${kind}.json`, body, {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  return new Response(null, { status: 204 });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const schemaMatch = url.pathname.match(/^\/api\/schemas\/([^/]+)$/);
    if (schemaMatch) {
      const kind = decodeURIComponent(schemaMatch[1]);
      if (request.method === 'GET') return handleSchemaGet(env, kind);
      if (request.method === 'PUT') return handleSchemaPut(request, env, kind);
      return new Response('Method Not Allowed', { status: 405 });
    }

    const componentMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/components\/(.+)$/);
    if (componentMatch) {
      const screenId = decodeURIComponent(componentMatch[1]);
      const componentId = decodeURIComponent(componentMatch[2]);
      if (request.method === 'GET') return handleComponentGet(env, screenId, componentId);
      if (request.method === 'PUT') return handleComponentPut(request, env, screenId, componentId);
      if (request.method === 'DELETE') return handleComponentDelete(env, screenId, componentId);
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url.pathname === '/api/layouts/json-files') {
      if (request.method === 'GET') return handleScreensJsonFilesGet(env);
      return new Response('Method Not Allowed', { status: 405 });
    }

    const jsonFilesMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/json-files$/);
    if (jsonFilesMatch) {
      const screenId = decodeURIComponent(jsonFilesMatch[1]);
      if (request.method === 'GET') {
        const prefix = url.searchParams.get('prefix') ?? 'components/';
        return handleJsonFilesGet(env, screenId, prefix);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    const renameMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/rename$/);
    if (renameMatch) {
      const id = decodeURIComponent(renameMatch[1]);
      if (request.method === 'POST') return handleScreenRename(request, env, id);
      return new Response('Method Not Allowed', { status: 405 });
    }

    const screenMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)$/);
    if (screenMatch) {
      const id = decodeURIComponent(screenMatch[1]);
      if (request.method === 'GET') return handleScreenGet(env, id);
      if (request.method === 'PUT') return handleScreenPut(request, env, id);
      if (request.method === 'DELETE') return handleScreenDelete(env, id);
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
