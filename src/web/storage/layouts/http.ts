import { isScreen } from '../../schema/screen/screen';
import { isSelectComponent } from '../../schema/component';
import type { LayoutBackend } from './r2';
import { normalizeScreen, normalizeComponentValue } from './normalize';

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

const normalizeScreenJson: JsonNormalizer = (_, __, value) => normalizeScreen(value);

// --- Screen registry ---

const SCREEN_REGISTRY_KEY = '_registry.json';

type ScreenRegistryEntry = { id: string; name: string };

const isScreenRegistryEntry = (v: unknown): v is ScreenRegistryEntry => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  return typeof c.id === 'string' && typeof c.name === 'string';
};

const loadScreenRegistry = async (backend: LayoutBackend): Promise<ScreenRegistryEntry[]> => {
  const stored = await backend.getText(SCREEN_REGISTRY_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (Array.isArray(parsed)) return parsed.filter(isScreenRegistryEntry);
  } catch { /* */ }
  return [];
};

const saveScreenRegistry = async (backend: LayoutBackend, entries: ScreenRegistryEntry[]): Promise<void> => {
  await backend.putText(SCREEN_REGISTRY_KEY, JSON.stringify(entries));
};

const copyScreenFiles = async (backend: LayoutBackend, fromId: string, toId: string): Promise<void> => {
  const mainBody = await backend.getText(`${fromId}.json`);
  if (mainBody) await backend.putText(`${toId}.json`, mainBody);
  const prefix = `${fromId}/components/`;
  let cursor: string | undefined;
  do {
    const result = await backend.list(prefix, cursor);
    for (const object of result.objects) {
      const file = await backend.getText(object.key);
      if (file) {
        await backend.putText(`${toId}/components/${object.key.slice(prefix.length)}`, file);
      }
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
};

const migrateScreensToRegistry = async (backend: LayoutBackend): Promise<ScreenRegistryEntry[]> => {
  const registry: ScreenRegistryEntry[] = [];
  let cursor: string | undefined;
  do {
    const result = await backend.list('', cursor);
    for (const object of result.objects) {
      if (!object.key.endsWith('.json')) continue;
      if (object.key === SCREEN_REGISTRY_KEY) continue;
      if (object.key.includes('/')) continue;
      const name = object.key.slice(0, -'.json'.length);
      const id = crypto.randomUUID();
      await copyScreenFiles(backend, name, id);
      registry.push({ id, name });
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  await saveScreenRegistry(backend, registry);
  return registry;
};

export const resolveScreenStorageId = async (backend: LayoutBackend, name: string): Promise<string | null> => {
  if (name === SCREEN_REGISTRY_KEY.slice(0, -'.json'.length)) return null;
  const registry = await loadScreenRegistry(backend);
  const entry = registry.find((e) => e.name === name);
  if (entry) return entry.id;
  const legacyBody = await backend.getText(`${name}.json`);
  if (legacyBody !== null) return name;
  return null;
};

const getOrCreateScreenStorageId = async (backend: LayoutBackend, name: string): Promise<string> => {
  const registry = await loadScreenRegistry(backend);
  const existing = registry.find((e) => e.name === name);
  if (existing) return existing.id;
  const legacyBody = await backend.getText(`${name}.json`);
  if (legacyBody !== null) {
    const id = crypto.randomUUID();
    await copyScreenFiles(backend, name, id);
    registry.push({ id, name });
    await saveScreenRegistry(backend, registry);
    return id;
  }
  const id = crypto.randomUUID();
  registry.push({ id, name });
  await saveScreenRegistry(backend, registry);
  return id;
};

// --- End screen registry ---

export const handleScreensListGet = async (backend: LayoutBackend): Promise<Response> => {
  let registry = await loadScreenRegistry(backend);
  if (registry.length === 0) {
    registry = await migrateScreensToRegistry(backend);
  }
  const items = registry
    .map((e) => ({ value: e.name, label: e.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return new Response(JSON.stringify({ items }), { headers: { 'Content-Type': 'application/json' } });
};

export const handleScreenGet = async (backend: LayoutBackend, name: string): Promise<Response> => {
  const storageId = await resolveScreenStorageId(backend, name);
  if (!storageId) return new Response('Not Found', { status: 404 });
  return handleResourceGet(backend, '', storageId, normalizeScreenJson);
};

export const handleComponentGet = async (backend: LayoutBackend, screenId: string, componentId: string): Promise<Response> => {
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

export const handleJsonFilesGet = async (backend: LayoutBackend, screenId: string, prefix: string): Promise<Response> => {
  const items = await buildJsonFileItems(backend, `${screenId}/${prefix}`);
  return new Response(JSON.stringify({ items }), { headers: { 'Content-Type': 'application/json' } });
};

export const handleScreenPut = async (request: Request, backend: LayoutBackend, name: string): Promise<Response> => {
  const storageId = await getOrCreateScreenStorageId(backend, name);
  return handleResourcePut(request, backend, '', storageId, normalizeScreenJson);
};

export const deleteScreenObjects = async (backend: LayoutBackend, screenId: string): Promise<void> => {
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

export const handleScreenDelete = async (backend: LayoutBackend, name: string): Promise<Response> => {
  const registry = await loadScreenRegistry(backend);
  const idx = registry.findIndex((e) => e.name === name);
  if (idx !== -1) {
    const [entry] = registry.splice(idx, 1);
    await deleteScreenObjects(backend, entry.id);
    await saveScreenRegistry(backend, registry);
  } else {
    await deleteScreenObjects(backend, name);
  }
  return new Response(null, { status: 204 });
};

export const handleScreenRename = async (request: Request, backend: LayoutBackend, name: string): Promise<Response> => {
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

  const registry = await loadScreenRegistry(backend);
  const idx = registry.findIndex((e) => e.name === name);

  if (idx === -1) {
    // Legacy fallback: file-based rename
    const source = await backend.getText(`${name}.json`);
    if (!source) return new Response('Not Found', { status: 404 });

    const existing = await backend.getText(`${to}.json`);
    if (existing) return new Response('Conflict', { status: 409 });

    await backend.putText(`${to}.json`, source);

    const prefix = `${name}/components/`;
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

    await deleteScreenObjects(backend, name);
    return new Response(null, { status: 204 });
  }

  if (registry.some((e) => e.name === to)) return new Response('Conflict', { status: 409 });

  registry[idx] = { ...registry[idx], name: to };
  await saveScreenRegistry(backend, registry);
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
    await backend.putText(`${screenId}/components/${componentId}.json`, JSON.stringify(normalized));
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  return new Response(null, { status: 204 });
};

export const handleComponentDelete = async (backend: LayoutBackend, screenId: string, componentId: string): Promise<Response> => {
  await backend.deleteKey(`${screenId}/components/${componentId}.json`);
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
