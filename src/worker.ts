import { isComponent, type Component } from './component';
import { isSelectComponent } from './component/kind/select';
import { allocateDefaultEntityName, assignDefaultEntityNames } from './name';
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

const LEGACY_CANVAS_IDS = new Set(['canvas']);

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
  const canvasIds = new Set<string>();
  for (const frame of frames) {
    if (frame.kind === 'canvas') {
      canvasIds.add(frame.id);
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
    if (frame.kind === 'component-editor') {
      const currentSourceCanvasId = typeof f.sourceCanvasId === 'string' ? f.sourceCanvasId : '';
      if (currentSourceCanvasId && canvasIds.has(currentSourceCanvasId)) return frame;
      const canvasId = canvasToEditorId.get(frame.id);
      if (canvasId !== undefined) return { ...frame, sourceCanvasId: canvasId };
    }
    return frame;
  });
};

const migrateLegacyCanvasIds = (frames: FrameCandidate[]): FrameCandidate[] => {
  const canvasIdMap = new Map<string, string>();
  for (const frame of frames) {
    if (frame.kind === 'canvas' && LEGACY_CANVAS_IDS.has(frame.id)) {
      canvasIdMap.set(frame.id, crypto.randomUUID());
    }
  }
  if (canvasIdMap.size === 0) return frames;

  return frames.map((frame) => {
    const f = frame as Record<string, unknown>;
    if (frame.kind === 'canvas' && canvasIdMap.has(frame.id)) {
      const nextId = canvasIdMap.get(frame.id) as string;
      const { targetComponentId: _, ...rest } = f;
      return { ...rest, id: nextId } as FrameCandidate;
    }
    if (frame.kind === 'list' && typeof f.targetComponentId === 'string' && canvasIdMap.has(f.targetComponentId)) {
      return { ...frame, targetComponentId: canvasIdMap.get(f.targetComponentId) } as FrameCandidate;
    }
    if (
      frame.kind === 'component-editor' &&
      typeof f.sourceCanvasId === 'string' &&
      canvasIdMap.has(f.sourceCanvasId)
    ) {
      return { ...frame, sourceCanvasId: canvasIdMap.get(f.sourceCanvasId) } as FrameCandidate;
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

  const frames = migrateEditorSource(
    migrateLegacyCanvasIds((candidate.frames as FrameCandidate[]).map(migrateFrameKind)),
  );
  const namedFrames = assignDefaultEntityNames(frames);
  const placedFrames = namedFrames.filter((f) => isFrame(f)) as Frame[];
  const existingMaxColumn = placedFrames.reduce(
    (max, f) => Math.max(max, f.placement.x + f.placement.width - 1),
    1,
  );
  const inputGrid = isGridLayout(candidate.grid) ? candidate.grid : null;
  const columns = Math.max(inputGrid ? inputGrid.columns : deriveColumns(namedFrames), existingMaxColumn);
  const rows = inputGrid?.rows;
  const occupied = collectOccupiedCells(placedFrames);

  const normalizedFrames = namedFrames.map((frame) => {
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

const isMeaningfulString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const listScreenComponents = async (
  backend: ReturnType<typeof createLayoutsBackend>,
  screenId: string,
  excludeKey?: string,
): Promise<Array<{ id: string; kind: string; name?: unknown }>> => {
  const result: Array<{ id: string; kind: string; name?: unknown }> = [];
  let cursor: string | undefined;
  const prefix = `${screenId}/components/`;
  do {
    const page = await backend.list(prefix, cursor);
    for (const object of page.objects) {
      if (!object.key.endsWith('.json')) continue;
      if (excludeKey && object.key === excludeKey) continue;
      const id = object.key.slice(prefix.length, -'.json'.length);
      const body = await backend.getText(object.key);
      if (!body) continue;
      try {
        const value = JSON.parse(body) as unknown;
        if (!isComponent(value)) continue;
        result.push({
          id,
          kind: (value as Record<string, unknown>).kind as string,
          name: (value as Record<string, unknown>).name,
        });
      } catch {
        continue;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return result;
};

const normalizeComponentValue = async (
  backend: ReturnType<typeof createLayoutsBackend>,
  screenId: string,
  componentId: string,
  value: unknown,
): Promise<Record<string, unknown> | null> => {
  if (!isComponent(value)) return null;

  const component = value as Record<string, unknown>;
  if (isMeaningfulString(component.name)) return component;

  const componentKey = `${screenId}/components/${componentId}.json`;
  const hasNameKey = Object.prototype.hasOwnProperty.call(component, 'name');

  if (!hasNameKey) {
    const existingBody = await backend.getText(componentKey);
    if (existingBody) {
      try {
        const existingValue = JSON.parse(existingBody) as unknown;
        if (isComponent(existingValue)) {
          const existingName = (existingValue as Record<string, unknown>).name;
          if (isMeaningfulString(existingName)) {
            return { ...component, name: existingName };
          }
        }
      } catch {
        // Fall through to auto-allocation.
      }
    }
  }

  const siblings = await listScreenComponents(backend, screenId, componentKey);
  const kind = component.kind as string;
  return {
    ...component,
    name: allocateDefaultEntityName(siblings, kind),
  };
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
  try {
    const value = JSON.parse(body) as unknown;
    const normalized = await normalizeComponentValue(backend, screenId, componentId, value);
    if (!normalized) return new Response('Invalid component', { status: 400 });
    const normalizedBody = JSON.stringify(normalized);
    if (body !== normalizedBody) {
      await backend.putText(`${screenId}/components/${componentId}.json`, normalizedBody);
    }
    return new Response(normalizedBody, { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
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
    const normalized = await normalizeComponentValue(backend, screenId, componentId, value);
    if (!normalized) return new Response('Invalid component', { status: 400 });
    if (normalized.kind === 'select' && !isSelectComponent(normalized)) {
      return new Response('Invalid component', { status: 400 });
    }
    await backend.putText(`${screenId}/components/${componentId}.json`, JSON.stringify(normalized));
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
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
