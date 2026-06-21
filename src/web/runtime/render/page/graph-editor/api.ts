import type { ExplorerNode } from './types';

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(input, init);
  if (r.status === 401) { window.location.href = '/login'; }
  return r;
}

export async function fetchAllNodes(
  graphId: string,
  includeIds: string[] = [],
  offset = 0,
  lang?: 'en' | 'ja',
  neighborOf?: string[],
  q?: string,
  limit = 20,
): Promise<{ nodes: ExplorerNode[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (includeIds.length > 0) params.set('include', includeIds.join(','));
  if (lang) params.set('lang', lang);
  if (neighborOf && neighborOf.length > 0) params.set('nonNeighborOf', neighborOf.join(','));
  if (q) params.set('q', q);
  const r = await apiFetch(`/api/v1/graph/${graphId}/nodes?${params}`);
  if (!r.ok) return { nodes: [], hasMore: false };
  const data = await r.json() as { nodes: ExplorerNode[]; hasMore?: boolean };
  return { nodes: data.nodes ?? [], hasMore: data.hasMore ?? false };
}

export async function fetchBookmarkedNodes(
  graphId: string,
  bookmarkIds: string[],
  lang?: 'en' | 'ja',
): Promise<{ nodes: ExplorerNode[]; hasMore: boolean }> {
  if (bookmarkIds.length === 0) return { nodes: [], hasMore: false };
  const params = new URLSearchParams({ offset: '0', onlyIncluded: 'true' });
  params.set('include', bookmarkIds.join(','));
  if (lang) params.set('lang', lang);
  const r = await apiFetch(`/api/v1/graph/${graphId}/nodes?${params}`);
  if (!r.ok) return { nodes: [], hasMore: false };
  const data = await r.json() as { nodes: ExplorerNode[]; hasMore?: boolean };
  // Preserve the order returned by the bookmarks API
  const idxMap = new Map(bookmarkIds.map((id, i) => [id, i]));
  const nodes = (data.nodes ?? []).sort((a, b) => (idxMap.get(a.id) ?? 999) - (idxMap.get(b.id) ?? 999));
  return { nodes, hasMore: false };
}

export async function fetchChildren(graphId: string, nodeId: string, limit: number): Promise<ExplorerNode[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/children?limit=${limit}`);
  if (!r.ok) return [];
  const data = await r.json() as { nodes: ExplorerNode[] };
  // Defensive dedup by id: legacy parallel edges can return the same node twice,
  // which would render duplicate rows that all share one id (deleting one deletes all).
  const seen = new Set<string>();
  return (data.nodes ?? []).filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
}

export async function apiCreateNode(
  graphId: string, parentId: string | null, lang: 'en' | 'ja', label: string,
  insertAfterId?: string,
): Promise<ExplorerNode | null> {
  const labelField = label ? (lang === 'en' ? { en: label } : { ja: label }) : {};
  const insertAfterField = insertAfterId ? { insertAfterId } : {};
  const body = parentId ? { parentId, ...labelField, ...insertAfterField } : labelField;
  const r = await apiFetch(`/api/v1/graph/${graphId}/node`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  return r.json() as Promise<ExplorerNode>;
}

export async function apiUpdateNode(
  graphId: string, nodeId: string, lang: 'en' | 'ja', label: string,
): Promise<void> {
  const body = lang === 'en' ? { en: label || null } : { ja: label || null };
  await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function apiUpdateColor(
  graphId: string, nodeId: string, color: string | null,
): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ color }),
  });
}

export async function apiDeleteNode(graphId: string, nodeId: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}`, { method: 'DELETE' });
}

export async function apiToggleLink(graphId: string, sourceId: string, targetId: string): Promise<boolean> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${sourceId}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId }),
  });
  if (!r.ok) return false;
  const data = await r.json() as { linked: boolean };
  return data.linked;
}

export async function fetchBookmarks(graphId: string): Promise<string[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/bookmarks`);
  if (!r.ok) return [];
  const data = await r.json() as { bookmarks: string[] };
  return data.bookmarks ?? [];
}

export async function apiAddBookmark(graphId: string, nodeId: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/bookmarks/${nodeId}`, { method: 'POST' });
}

export async function apiRemoveBookmark(graphId: string, nodeId: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/bookmarks/${nodeId}`, { method: 'DELETE' });
}

export async function apiMoveBookmark(graphId: string, nodeId: string, direction: 'up' | 'down'): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/bookmarks/${nodeId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  });
}

export async function fetchColors(graphId: string): Promise<Array<{ id: string; code: string }>> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/colors`);
  if (!r.ok) return [];
  const data = await r.json() as { colors: Array<{ id: string; code: string }> };
  return data.colors ?? [];
}

export async function fetchPropertyColors(graphId: string): Promise<Record<string, { colorId: string; code: string }>> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/property-color`);
  if (!r.ok) return {};
  const data = await r.json() as { propertyColors: Record<string, { colorId: string; code: string }> };
  return data.propertyColors ?? {};
}

export async function apiSetPropertyColor(graphId: string, key: string, colorId: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/property-color`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, colorId }),
  });
}

export async function apiRemovePropertyColor(graphId: string, key: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/property-color/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

export async function fetchPropertyOrder(graphId: string): Promise<string[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/property-order`);
  if (!r.ok) return [];
  const data = await r.json() as { keys: string[] };
  return data.keys ?? [];
}

export async function fetchAllPropertyKeys(graphId: string): Promise<string[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/property-keys`);
  if (!r.ok) return [];
  const data = await r.json() as { keys: string[] };
  return data.keys ?? [];
}

export async function apiSavePropertyOrder(graphId: string, keys: string[]): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/property-order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  });
}

export async function apiDeletePropertyKey(graphId: string, key: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/property-key/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

export async function apiSetProperty(graphId: string, nodeId: string, key: string, value: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/property`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
}

export async function apiRemoveProperty(graphId: string, nodeId: string, key: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/property/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

export async function apiMoveNode(
  graphId: string, nodeId: string, parentId: string, direction: 'up' | 'down',
  afterSwapSiblingIds: string[],
): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction, parentId, afterSwapSiblingIds }),
  });
}
