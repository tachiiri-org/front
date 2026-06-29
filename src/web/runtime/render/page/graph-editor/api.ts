import type { ExplorerNode, ExplorerLine } from './types';

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
  return (data.nodes ?? [])
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
}

// A node's ORIENTED parents (the nodes marked as its parent via h_orientation). Used to render a
// multi-parent node under each of its paths in a mirror/drill pane.
export async function fetchParents(graphId: string, nodeId: string): Promise<ExplorerNode[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/parents`);
  if (!r.ok) return [];
  const data = await r.json() as { nodes: ExplorerNode[] };
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

// ノード色を設定（code=null/省略で解除）。色は p_node_color に保存され、
// 読み出し時に ExplorerNode.color として返る。
export async function apiSetNodeColor(graphId: string, nodeId: string, code: string | null): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ color: code }),
  });
}

// 冪等リンク: node→target の辺を貼る（既に在れば何もしない）。返り値は最終状態。
export async function apiLinkNode(graphId: string, nodeId: string, targetNodeId: string): Promise<boolean> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_id: nodeId, target_node_id: targetNodeId }),
  });
  if (!r.ok) return false;
  const data = await r.json() as { linked: boolean };
  return data.linked;
}

// 冪等アンリンク: node→target の辺を外す（無ければ何もしない）。返り値は最終状態。
export async function apiUnlinkNode(graphId: string, nodeId: string, targetNodeId: string): Promise<boolean> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/link`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_id: nodeId, target_node_id: targetNodeId }),
  });
  if (!r.ok) return false;
  const data = await r.json() as { linked: boolean };
  return data.linked;
}

export async function apiMoveNode(
  graphId: string, nodeId: string, parentId: string, direction: 'up' | 'down',
  afterSwapSiblingIds: string[], keepalive = false,
): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction, parentId, afterSwapSiblingIds }),
    keepalive,
  });
}

// ── 関係 line (relation line) ────────────────────────────────────────────────
// A relation line is an n-ary edge that carries free-text prose (body) connecting its participant
// nodes (ordered; head = subject). See backend p_line_body / h_ray.

// ノードが参加している関係 line 一覧（本文＋順序付き参加者）。ツリー枝は含まれない。
export async function fetchNodeLines(graphId: string, nodeId: string): Promise<ExplorerLine[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/lines`);
  if (!r.ok) return [];
  const data = await r.json() as { lines: ExplorerLine[] };
  return data.lines ?? [];
}

// nodeId を主語（先頭参加者）にした関係 line を新規作成。
export async function apiCreateRelation(
  graphId: string, nodeId: string, lang: 'en' | 'ja', body?: string,
): Promise<ExplorerLine | null> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/relation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, ...(body ? { body } : {}) }),
  });
  if (!r.ok) return null;
  return r.json() as Promise<ExplorerLine>;
}

// 関係 line の本文を言語ごとに設定（空文字でも行は残り、関係 line のマークは保持）。
export async function apiSetLineBody(graphId: string, lineId: string, lang: 'en' | 'ja', body: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/line/${lineId}/body`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, body }),
  });
}

// 参加者を追加（afterNodeId 指定でその直後、無指定で末尾）。返り値は更新後の順序付き参加者。
export async function apiAddRay(
  graphId: string, lineId: string, nodeId: string, afterNodeId?: string,
): Promise<ExplorerNode[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/line/${lineId}/ray`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId, ...(afterNodeId ? { afterNodeId } : {}) }),
  });
  if (!r.ok) return [];
  const data = await r.json() as { participants: ExplorerNode[] };
  return data.participants ?? [];
}

// 参加者を削除（残り0なら line ごと削除される）。
export async function apiRemoveRay(graphId: string, lineId: string, nodeId: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/line/${lineId}/ray/${nodeId}`, { method: 'DELETE' });
}

// 参加者順を明示配列で再構築（h_ray を貼り直す）。
export async function apiReorderRay(graphId: string, lineId: string, order: string[]): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/line/${lineId}/ray/order`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  });
}

// 参加ノードを1つも持たない関係（本文だけ＝リンクなし関係 / orphan）の一覧。
export async function fetchOrphanLines(graphId: string): Promise<ExplorerLine[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/orphan-lines`);
  if (!r.ok) return [];
  const data = await r.json() as { lines: ExplorerLine[] };
  return data.lines ?? [];
}

// 関係(line)を丸ごと削除（チップ削除とは別の、関係そのものの削除）。
export async function apiDeleteLine(graphId: string, lineId: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/line/${lineId}`, { method: 'DELETE' });
}
