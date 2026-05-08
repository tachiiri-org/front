import { isScreen } from '../../schema/screen/screen';
import { isSelectComponent } from '../../schema/component';
import type { LayoutBackend } from './r2';
import { normalizeScreen, normalizeComponentValue } from './normalize';

type ListItem = {
  value: string;
  label: string;
};

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

export const handleScreenGet = async (backend: LayoutBackend, id: string): Promise<Response> => {
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

export const handleScreensJsonFilesGet = async (backend: LayoutBackend): Promise<Response> => {
  const items = await buildJsonFileItems(backend, '', { excludeNested: true });
  return new Response(JSON.stringify({ items }), {
    headers: { 'Content-Type': 'application/json' },
  });
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

export const handleScreenPut = async (request: Request, backend: LayoutBackend, id: string): Promise<Response> => {
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

export const handleScreenDelete = async (backend: LayoutBackend, id: string): Promise<Response> => {
  await deleteScreenObjects(backend, id);
  return new Response(null, { status: 204 });
};

export const handleScreenRename = async (request: Request, backend: LayoutBackend, id: string): Promise<Response> => {
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

export const handleResourceGet = async (backend: LayoutBackend, storagePrefix: string, id: string): Promise<Response> => {
  const body = await backend.getText(`${storagePrefix}${id}.json`);
  if (body === null) return new Response('Not Found', { status: 404 });
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
};

export const handleResourcePut = async (request: Request, backend: LayoutBackend, storagePrefix: string, id: string): Promise<Response> => {
  const body = await request.text();
  try {
    JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  await backend.putText(`${storagePrefix}${id}.json`, body);
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
