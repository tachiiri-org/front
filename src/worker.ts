import {
  isComponent,
  isComponentDocument,
  isGridDocument,
  isGridLayout,
  isLayout,
  isPlacedComponent,
  isSelectDocument,
  type Component,
  type Layout,
  type Placement,
  type PlacedComponent,
} from './layout';

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

const isHeadLike = (value: unknown): value is Layout['head'] => {
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

const deriveColumns = (components: Component[]): number => Math.max(1, Math.ceil(Math.sqrt(Math.max(components.length, 1))));

const cellKey = (x: number, y: number): string => `${x}:${y}`;

const occupiesCells = (placement: Placement): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let row = placement.y; row < placement.y + placement.height; row += 1) {
    for (let column = placement.x; column < placement.x + placement.width; column += 1) {
      cells.push([column, row]);
    }
  }
  return cells;
};

const collectOccupiedCells = (components: PlacedComponent[]): Set<string> => {
  const occupied = new Set<string>();
  for (const component of components) {
    for (const [x, y] of occupiesCells(component.placement)) {
      occupied.add(cellKey(x, y));
    }
  }
  return occupied;
};

const findNextPlacement = (occupied: Set<string>, columns: number): Placement => {
  for (let row = 1; ; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const key = cellKey(column, row);
      if (occupied.has(key)) {
        continue;
      }

      occupied.add(key);
      return { x: column, y: row, width: 1, height: 1 };
    }
  }
};

const normalizeLayout = (value: unknown): Layout | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (!isHeadLike(candidate.head)) {
    return null;
  }

  if (!isStringRecord(candidate.shell) || !Array.isArray(candidate.components) || !candidate.components.every(isComponent)) {
    return null;
  }

  const components = candidate.components as Component[];
  const placedComponents = components.filter(isPlacedComponent);
  const existingMaxColumn = placedComponents.reduce(
    (max, component) => Math.max(max, component.placement.x + component.placement.width - 1),
    1,
  );
  const columns = Math.max(
    isGridLayout(candidate.grid) ? candidate.grid.columns : deriveColumns(components),
    existingMaxColumn,
  );
  const occupied = collectOccupiedCells(placedComponents);

  const normalizedComponents = components.map((component) => {
    if (isPlacedComponent(component) && isPositiveInteger(component.placement.width) && isPositiveInteger(component.placement.height)) {
      return component;
    }

    return {
      ...component,
      placement: findNextPlacement(occupied, columns),
    };
  });

  const normalized: Layout = {
    head: candidate.head as Layout['head'],
    shell: candidate.shell,
    grid: {
      kind: 'grid',
      columns,
    },
    components: normalizedComponents,
  };

  return isLayout(normalized) ? normalized : null;
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
      const value = relative.slice(0, -'.json'.length);
      if (!seen.has(value)) {
        seen.set(value, { value, label: value });
      }
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);

  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
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

  const body = await object.text();
  try {
    const value = JSON.parse(body) as unknown;
    const normalized = normalizeLayout(value);
    if (!normalized) {
      return new Response('Invalid layout', { status: 400 });
    }

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

const handleLayoutsJsonFilesGet = async (env: Env): Promise<Response> => {
  const items = await buildJsonFileItems(env, '', { excludeNested: true });
  return new Response(JSON.stringify({ items }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

const handleComponentGet = async (env: Env, layoutId: string, componentId: string): Promise<Response> => {
  const object = await env.LAYOUTS.get(`${layoutId}/components/${componentId}.json`);
  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  return new Response(object.body, {
    headers: { 'Content-Type': 'application/json' },
  });
};

const handleJsonFilesGet = async (env: Env, layoutId: string, prefix: string): Promise<Response> => {
  const items = await buildJsonFileItems(env, `${layoutId}/${prefix}`);
  return new Response(JSON.stringify({ items }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

const handleLayoutPut = async (request: Request, env: Env, id: string): Promise<Response> => {
  const body = await request.text();

  try {
    const value = JSON.parse(body) as unknown;
    const normalized = normalizeLayout(value);
    if (!normalized) {
      return new Response('Invalid layout', { status: 400 });
    }

    await env.LAYOUTS.put(`${id}.json`, JSON.stringify(normalized), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  return new Response(null, { status: 204 });
};

const deleteLayoutObjects = async (env: Env, layoutId: string): Promise<void> => {
  await env.LAYOUTS.delete(`${layoutId}.json`);

  let cursor: string | undefined;
  do {
    const result = await env.LAYOUTS.list({ prefix: `${layoutId}/components/`, cursor });
    if (result.objects.length > 0) {
      await env.LAYOUTS.delete(result.objects.map((object) => object.key));
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
};

const handleLayoutDelete = async (env: Env, id: string): Promise<Response> => {
  await deleteLayoutObjects(env, id);
  return new Response(null, { status: 204 });
};

const handleComponentPut = async (
  request: Request,
  env: Env,
  layoutId: string,
  componentId: string,
): Promise<Response> => {
  const body = await request.text();

  try {
    const value = JSON.parse(body) as unknown;
    if (
      (!isComponentDocument(value) && !isComponent(value)) ||
      (typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).kind === 'select' &&
        !isSelectDocument(value)) ||
      (typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).kind === 'grid' &&
        !isGridDocument(value))
    ) {
      return new Response('Invalid component', { status: 400 });
    }
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  await env.LAYOUTS.put(`${layoutId}/components/${componentId}.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });

  return new Response(null, { status: 204 });
};

const handleComponentDelete = async (env: Env, layoutId: string, componentId: string): Promise<Response> => {
  await env.LAYOUTS.delete(`${layoutId}/components/${componentId}.json`);
  return new Response(null, { status: 204 });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const componentMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/components\/(.+)$/);
    if (componentMatch) {
      const layoutId = decodeURIComponent(componentMatch[1]);
      const componentId = decodeURIComponent(componentMatch[2]);
      if (request.method === 'GET') return handleComponentGet(env, layoutId, componentId);
      if (request.method === 'PUT') return handleComponentPut(request, env, layoutId, componentId);
      if (request.method === 'DELETE') return handleComponentDelete(env, layoutId, componentId);
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url.pathname === '/api/layouts/json-files') {
      if (request.method === 'GET') return handleLayoutsJsonFilesGet(env);
      return new Response('Method Not Allowed', { status: 405 });
    }

    const jsonFilesMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)\/json-files$/);
    if (jsonFilesMatch) {
      const layoutId = decodeURIComponent(jsonFilesMatch[1]);
      if (request.method === 'GET') {
        const prefix = url.searchParams.get('prefix') ?? 'components/';
        return handleJsonFilesGet(env, layoutId, prefix);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    const layoutMatch = url.pathname.match(/^\/api\/layouts\/([^/]+)$/);
    if (layoutMatch) {
      const id = decodeURIComponent(layoutMatch[1]);
      if (request.method === 'GET') return handleLayoutGet(env, id);
      if (request.method === 'PUT') return handleLayoutPut(request, env, id);
      if (request.method === 'DELETE') return handleLayoutDelete(env, id);
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
