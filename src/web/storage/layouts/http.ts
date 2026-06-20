import { isScreen } from '../../schema/screen/screen';
import { isSelectComponent } from '../../schema/component';
import type { LayoutBackend, ScreenNameBackend } from './r2';
import { normalizeComponentValue } from './normalize';

const SCREEN_PREFIX = 'screens/';

type ListItem = {
  value: string;
  label: string;
};

type JsonNormalizer = (
  backend: LayoutBackend,
  id: string,
  value: unknown,
) => Promise<unknown | null> | unknown | null;

const buildJsonFileItems = async (
  backend: LayoutBackend,
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


// --- Screen registry (D1-backed via ScreenNameBackend) ---

export const resolveScreenStorageId = async (
  backend: LayoutBackend,
  screenNames: ScreenNameBackend,
  name: string,
): Promise<string | null> => {
  const entries = await screenNames.list();
  const entry = entries.find((e) => e.name === name);
  return entry ? entry.id : null;
};

const getOrCreateScreenStorageId = async (
  backend: LayoutBackend,
  screenNames: ScreenNameBackend,
  name: string,
): Promise<string> => {
  const entries = await screenNames.list();
  const existing = entries.find((e) => e.name === name);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await screenNames.create(id, name);
  return id;
};

// --- End screen registry ---

export const handleScreensListGet = async (screenNames: ScreenNameBackend): Promise<Response> => {
  const entries = await screenNames.list();
  const items = entries.map((e) => ({ value: e.name, label: e.name }));
  return new Response(JSON.stringify({ items }), { headers: { 'Content-Type': 'application/json' } });
};

export const handleScreenGet = async (
  backend: LayoutBackend,
  screenNames: ScreenNameBackend,
  name: string,
): Promise<Response> => {
  const storageId = await resolveScreenStorageId(backend, screenNames, name);
  if (!storageId) return new Response('Not Found', { status: 404 });
  return handleResourceGet(backend, SCREEN_PREFIX, storageId);
};

export const handleComponentGet = async (backend: LayoutBackend, screenId: string, componentId: string): Promise<Response> => {
  const key = `${SCREEN_PREFIX}${screenId}/components/${componentId}.json`;
  const body = await backend.getText(key);
  if (body === null) return new Response('Not Found', { status: 404 });
  try {
    const value = JSON.parse(body) as unknown;
    const normalized = await normalizeComponentValue(backend, screenId, componentId, value);
    if (!normalized) return new Response('Invalid component', { status: 400 });
    const normalizedBody = JSON.stringify(normalized);
    if (body !== normalizedBody) await backend.putText(key, normalizedBody);
    return new Response(normalizedBody, { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
};

export const handleJsonFilesGet = async (backend: LayoutBackend, screenId: string, prefix: string): Promise<Response> => {
  const items = await buildJsonFileItems(backend, `${SCREEN_PREFIX}${screenId}/${prefix}`);
  return new Response(JSON.stringify({ items }), { headers: { 'Content-Type': 'application/json' } });
};

export const handleScreenPut = async (
  request: Request,
  backend: LayoutBackend,
  screenNames: ScreenNameBackend,
  name: string,
): Promise<Response> => {
  const storageId = await getOrCreateScreenStorageId(backend, screenNames, name);
  return handleResourcePut(request, backend, SCREEN_PREFIX, storageId);
};

export const deleteScreenObjects = async (backend: LayoutBackend, screenId: string): Promise<void> => {
  await backend.deleteKey(`${SCREEN_PREFIX}${screenId}.json`);
  let cursor: string | undefined;
  do {
    const result = await backend.list(`${SCREEN_PREFIX}${screenId}/components/`, cursor);
    if (result.objects.length > 0) {
      await Promise.all(result.objects.map((o) => backend.deleteKey(o.key)));
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
};

export const handleScreenDelete = async (
  backend: LayoutBackend,
  screenNames: ScreenNameBackend,
  name: string,
): Promise<Response> => {
  const entries = await screenNames.list();
  const entry = entries.find((e) => e.name === name);
  if (entry) {
    await deleteScreenObjects(backend, entry.id);
    await screenNames.delete(entry.id);
  }
  return new Response(null, { status: 204 });
};

export const handleScreenRename = async (
  request: Request,
  backend: LayoutBackend,
  screenNames: ScreenNameBackend,
  name: string,
): Promise<Response> => {
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

  if (!to || to === name || to.includes('/')) return new Response('Invalid target name', { status: 400 });

  const entries = await screenNames.list();
  const entry = entries.find((e) => e.name === name);
  if (!entry) return new Response('Not Found', { status: 404 });

  try {
    await screenNames.rename(entry.id, to);
  } catch (e) {
    if (e instanceof Error && e.message === 'screens_rename_conflict') return new Response('Conflict', { status: 409 });
    throw e;
  }
  return new Response(null, { status: 204 });
};

export const handleComponentPut = async (
  request: Request,
  backend: LayoutBackend,
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
    await backend.putText(`${SCREEN_PREFIX}${screenId}/components/${componentId}.json`, JSON.stringify(normalized));
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  return new Response(null, { status: 204 });
};

export const handleComponentDelete = async (backend: LayoutBackend, screenId: string, componentId: string): Promise<Response> => {
  await backend.deleteKey(`${SCREEN_PREFIX}${screenId}/components/${componentId}.json`);
  return new Response(null, { status: 204 });
};

export const handleResourceListGet = async (backend: LayoutBackend, storagePrefix: string): Promise<Response> => {
  const items = await buildJsonFileItems(backend, storagePrefix, { excludeNested: true });
  return new Response(JSON.stringify({ items }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const handleResourceGet = async (
  backend: LayoutBackend,
  storagePrefix: string,
  id: string,
  normalize?: JsonNormalizer,
): Promise<Response> => {
  const body = await backend.getText(`${storagePrefix}${id}.json`);
  if (body === null) return new Response('Not Found', { status: 404 });
  if (!normalize) return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  try {
    const value = JSON.parse(body) as unknown;
    const normalized = await normalize(backend, id, value);
    if (!normalized) return new Response('Invalid JSON', { status: 400 });
    const normalizedBody = JSON.stringify(normalized);
    if (body !== normalizedBody) {
      await backend.putText(`${storagePrefix}${id}.json`, normalizedBody);
    }
    return new Response(normalizedBody, {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
};

export const handleResourcePut = async (
  request: Request,
  backend: LayoutBackend,
  storagePrefix: string,
  id: string,
  normalize?: JsonNormalizer,
): Promise<Response> => {
  const body = await request.text();
  try {
    const parsed = JSON.parse(body) as unknown;
    const normalized = normalize ? await normalize(backend, id, parsed) : parsed;
    if (!normalized) return new Response('Invalid JSON', { status: 400 });
    await backend.putText(`${storagePrefix}${id}.json`, JSON.stringify(normalized));
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  return new Response(null, { status: 204 });
};

export const handleResourceDelete = async (backend: LayoutBackend, storagePrefix: string, id: string): Promise<Response> => {
  await backend.deleteKey(`${storagePrefix}${id}.json`);
  return new Response(null, { status: 204 });
};

export const handleResourceRename = async (request: Request, backend: LayoutBackend, storagePrefix: string, id: string): Promise<Response> => {
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

  const sourceKey = `${storagePrefix}${id}.json`;
  const destKey = `${storagePrefix}${to}.json`;

  const source = await backend.getText(sourceKey);
  if (!source) return new Response('Not Found', { status: 404 });

  const existing = await backend.getText(destKey);
  if (existing) return new Response('Conflict', { status: 409 });

  await backend.putText(destKey, source);
  await backend.deleteKey(sourceKey);
  return new Response(null, { status: 204 });
};
