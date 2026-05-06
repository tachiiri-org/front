import { isComponent, type Component } from './component';
import { isSelectComponent } from './component/kind/select';
import {
  isScreen,
  isGridLayout,
  isFrame,
  isPlacement,
  type Screen,
  type Frame,
  type Placement,
} from './screen';
import { isHead } from './head';
import { createLayoutsBackend, type LayoutsEnv } from './layouts';

type Env = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
} & LayoutsEnv;

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


const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const DEFAULT_GRID_CANVAS_VIEWPORT = {
  width: 1920,
  height: 1080,
} as const;

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

const KIND_MIGRATIONS: Record<string, string> = {
  'screen-list': 'list',
  'grid-canvas': 'canvas',
};

const migrateFrameKind = (frame: FrameCandidate): FrameCandidate => {
  const f = frame as Record<string, unknown>;
  let kind = frame.kind;
  if (kind === 'grid' && typeof f.src !== 'string' && typeof f.targetComponentId === 'string') {
    kind = 'canvas';
  } else {
    kind = KIND_MIGRATIONS[kind] ?? kind;
  }
  const result: Record<string, unknown> = { ...f, kind };
  if (result.kind === 'list' && typeof result.src !== 'string') {
    result.src = '/api/layouts/json-files';
  }
  return result as FrameCandidate;
};

const migrateEditorSource = (frames: FrameCandidate[]): FrameCandidate[] => {
  const canvasToEditorId = new Map<string, string>();
  for (const frame of frames) {
    if (frame.kind === 'canvas') {
      const targetId = (frame as Record<string, unknown>).targetComponentId;
      if (typeof targetId === 'string' && targetId) {
        canvasToEditorId.set(targetId, frame.id);
      }
    }
  }
  return frames.map((frame) => {
    const f = frame as Record<string, unknown>;
    if (frame.kind === 'canvas' && typeof f.targetComponentId === 'string') {
      const { targetComponentId: _, ...rest } = f;
      return rest as FrameCandidate;
    }
    if (frame.kind === 'component-editor' && typeof f.sourceCanvasId !== 'string') {
      const canvasId = canvasToEditorId.get(frame.id);
      if (canvasId !== undefined) {
        return { ...frame, sourceCanvasId: canvasId };
      }
    }
    return frame;
  });
};

const normalizeScreen = (value: unknown): Screen | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (!isHead(candidate.head)) return null;
  if (!isStringRecord(candidate.shell)) return null;
  if (!Array.isArray(candidate.frames) || !candidate.frames.every(isFrameCandidate)) return null;

  const frames = migrateEditorSource((candidate.frames as FrameCandidate[]).map(migrateFrameKind));
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
      if ((frame as Record<string, unknown>).kind === 'canvas') {
        return {
          ...frame,
          viewportWidth: isPositiveInteger((frame as Record<string, unknown>).viewportWidth)
            ? (frame as Record<string, unknown>).viewportWidth
            : DEFAULT_GRID_CANVAS_VIEWPORT.width,
          viewportHeight: isPositiveInteger((frame as Record<string, unknown>).viewportHeight)
            ? (frame as Record<string, unknown>).viewportHeight
            : DEFAULT_GRID_CANVAS_VIEWPORT.height,
        } as Frame;
      }
      return frame as Frame;
    }
    if ((frame as Record<string, unknown>).kind === 'canvas') {
      return {
        ...frame,
        placement: findNextPlacement(occupied, columns),
        viewportWidth: DEFAULT_GRID_CANVAS_VIEWPORT.width,
        viewportHeight: DEFAULT_GRID_CANVAS_VIEWPORT.height,
      } as Frame;
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
  backend: ReturnType<typeof createLayoutsBackend>,
  prefixKey: string,
  options?: { excludeNested?: boolean },
): Promise<ListItem[]> => {
  const seen = new Map<string, ListItem>();

  let cursor: string | undefined;
  do {
    const result = await backend.list(prefixKey, cursor);
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

const handleScreenGet = async (backend: ReturnType<typeof createLayoutsBackend>, id: string): Promise<Response> => {
  const body = await backend.getText(`${id}.json`);
  if (body === null) return new Response('Not Found', { status: 404 });
  try {
    const value = JSON.parse(body) as unknown;
    const normalized = normalizeScreen(value);
    if (!normalized) return new Response('Invalid screen', { status: 400 });

    if (JSON.stringify(value) !== JSON.stringify(normalized)) {
      await backend.putText(`${id}.json`, JSON.stringify(normalized));
    }

    return new Response(JSON.stringify(normalized), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
};

const handleScreensJsonFilesGet = async (backend: ReturnType<typeof createLayoutsBackend>): Promise<Response> => {
  const items = await buildJsonFileItems(backend, '', { excludeNested: true });
  return new Response(JSON.stringify({ items }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

const handleComponentGet = async (backend: ReturnType<typeof createLayoutsBackend>, screenId: string, componentId: string): Promise<Response> => {
  const body = await backend.getText(`${screenId}/components/${componentId}.json`);
  if (body === null) return new Response('Not Found', { status: 404 });
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
};

const handleJsonFilesGet = async (backend: ReturnType<typeof createLayoutsBackend>, screenId: string, prefix: string): Promise<Response> => {
  const items = await buildJsonFileItems(backend, `${screenId}/${prefix}`);
  return new Response(JSON.stringify({ items }), { headers: { 'Content-Type': 'application/json' } });
};

const handleScreenPut = async (request: Request, backend: ReturnType<typeof createLayoutsBackend>, id: string): Promise<Response> => {
  const body = await request.text();
  try {
    const value = JSON.parse(body) as unknown;
    const normalized = normalizeScreen(value);
    if (!normalized) return new Response('Invalid screen', { status: 400 });
    await backend.putText(`${id}.json`, JSON.stringify(normalized));
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  return new Response(null, { status: 204 });
};

const deleteScreenObjects = async (backend: ReturnType<typeof createLayoutsBackend>, screenId: string): Promise<void> => {
  await backend.deleteKey(`${screenId}.json`);
  let cursor: string | undefined;
  do {
    const result = await backend.list(`${screenId}/components/`, cursor);
    if (result.objects.length > 0) {
      await Promise.all(result.objects.map((o) => backend.deleteKey(o.key)));
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
};

const handleScreenDelete = async (backend: ReturnType<typeof createLayoutsBackend>, id: string): Promise<Response> => {
  await deleteScreenObjects(backend, id);
  return new Response(null, { status: 204 });
};

const handleScreenRename = async (request: Request, backend: ReturnType<typeof createLayoutsBackend>, id: string): Promise<Response> => {
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

  const source = await backend.getText(`${id}.json`);
  if (!source) return new Response('Not Found', { status: 404 });

  const existing = await backend.getText(`${to}.json`);
  if (existing) return new Response('Conflict', { status: 409 });

  await backend.putText(`${to}.json`, source);

  const prefix = `${id}/components/`;
  let cursor: string | undefined;
  do {
    const result = await backend.list(prefix, cursor);
    for (const object of result.objects) {
      const file = await backend.getText(object.key);
      if (file) {
        await backend.putText(
          `${to}/components/${object.key.slice(prefix.length)}`,
          file,
        );
      }
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);

  await deleteScreenObjects(backend, id);
  return new Response(null, { status: 204 });
};

const handleComponentPut = async (
  request: Request,
  backend: ReturnType<typeof createLayoutsBackend>,
  screenId: string,
  componentId: string,
): Promise<Response> => {
  const body = await request.text();
  try {
    const value = JSON.parse(body) as unknown;
    if (!isComponent(value)) return new Response('Invalid component', { status: 400 });
    if ((value as Record<string, unknown>).kind === 'select' && !isSelectComponent(value)) {
      return new Response('Invalid component', { status: 400 });
    }
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  await backend.putText(`${screenId}/components/${componentId}.json`, body);
  return new Response(null, { status: 204 });
};

const handleComponentDelete = async (backend: ReturnType<typeof createLayoutsBackend>, screenId: string, componentId: string): Promise<Response> => {
  await backend.deleteKey(`${screenId}/components/${componentId}.json`);
  return new Response(null, { status: 204 });
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
      return new Response('<!doctype html><script type="module" src="/app.js"></script>', {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
