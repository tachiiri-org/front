import type { ExplorerNode, ExplorerLine } from './types';

// ── Client-side request gate ──────────────────────────────────────────────
// The graph runs on a single-threaded per-tenant Durable Object behind a 120-reads/60s rate
// limiter, so the editor must be frugal: too many concurrent reads both trip the limit and
// starve the DO (making writes like /move fail). We cap concurrency low; the bigger lever is
// simply issuing far fewer reads (no children pre-warming — see outliner). We do NOT retry 429s:
// the limiter uses a fixed 60s window, so an in-window retry just re-fails and spams the console.
// All requests funnel through apiFetch, so this one choke point governs the whole editor.
const MAX_CONCURRENT = 3;
let active = 0;
const waiters: Array<() => void> = [];
const acquire = (): Promise<void> =>
  active < MAX_CONCURRENT
    ? (active++, Promise.resolve())
    : new Promise<void>((resolve) => waiters.push(() => { active++; resolve(); }));
const release = () => { active--; waiters.shift()?.(); };

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  // keepalive requests fire during page unload (reorder flush) — never queue/delay them.
  if (init?.keepalive) {
    const r = await fetch(input, init);
    if (r.status === 401) { window.location.href = '/login'; }
    return r;
  }
  await acquire();
  try {
    const r = await fetch(input, init);
    if (r.status === 401) { window.location.href = '/login'; }
    return r;
  } finally {
    release();
  }
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

// Whole structural tree in one response (full-load editor): every member node with labels/colors,
// plus per-parent ordered child ids. The client assembles a single-parent tree from `parents`.
export async function fetchTree(graphId: string): Promise<{ nodes: ExplorerNode[]; parents: Record<string, string[]> }> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/tree`);
  if (!r.ok) return { nodes: [], parents: {} };
  const data = await r.json() as { nodes?: ExplorerNode[]; parents?: Record<string, string[]> };
  return { nodes: data.nodes ?? [], parents: data.parents ?? {} };
}

// Declaratively persist structure: for each parent, its children are exactly `childIds` in order.
// Backend reconciles edges/orientation/order idempotently. Returns true on success (204).
export async function saveTree(
  graphId: string,
  parents: { parentId: string; childIds: string[] }[],
  keepalive = false,
): Promise<boolean> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/tree`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parents }),
    keepalive,
  });
  return r.ok;
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

// How many places a node appears as a child in the tree (structural placements, oriented OR not).
// Used by delete to decide "multi-placed → unlink this spot" vs "last placement → delete entity".
// More reliable than fetchParents (which only counts ORIENTED parents) for that decision.
export async function fetchPlacementCount(graphId: string, nodeId: string): Promise<number> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/placement-count`);
  if (!r.ok) return 1;
  const data = await r.json() as { count?: number };
  return data.count ?? 1;
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

// ノード削除。promoteToId を渡すと、削除ノードの子をその親(=祖父母)へ昇格させてから消す
// （子が「リンクなし」に落ちないように）。省略時は従来通り。
// 戻り値 ok=false は削除が拒否されたことを表す。relationCount>0 なら「関係テキストが紐づくため
// 削除不可」（バックエンドの 409 ガード）。呼び出し側は楽観的に消した UI を戻す。
export async function apiDeleteNode(
  graphId: string, nodeId: string, promoteToId?: string,
): Promise<{ ok: boolean; relationCount?: number }> {
  const q = promoteToId ? `?promoteTo=${encodeURIComponent(promoteToId)}` : '';
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}${q}`, { method: 'DELETE' });
  if (r.ok) return { ok: true };
  if (r.status === 409) {
    const data = await r.json().catch(() => ({})) as { relationCount?: number };
    return { ok: false, relationCount: data.relationCount };
  }
  return { ok: false };
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

// 構造リンクの親向き(h_orientation)を設定。parentId が線の親側になる（clear=true で無向へ戻す）。
export async function apiOrient(graphId: string, nodeId: string, parentId: string, clear = false): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/orient`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId, parentId, ...(clear ? { clear: true } : {}) }),
  });
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

// ノードの（向き付けされた）親ノード一覧。DAG なので複数返り得る。
export async function fetchNodeParents(graphId: string, nodeId: string): Promise<ExplorerNode[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/parents`);
  if (!r.ok) return [];
  const data = await r.json() as { nodes: ExplorerNode[] };
  return data.nodes ?? [];
}

// ルート→…→nodeId のパンくずパスを、親を辿って構築する（先頭の親を採用）。
// 起点ノードのラベルは呼び出し側が渡す（チップの表示ラベル）。root は「ルート」表記に揃える。
export async function fetchNodePath(
  graphId: string, nodeId: string, label: string, rootNodeId: string | null, lang: 'en' | 'ja',
): Promise<Array<{ id: string | null; label: string }>> {
  const labelOf = (n: ExplorerNode) => (lang === 'ja' ? n.ja : n.en) || (lang === 'ja' ? n.en : n.ja) || n.id;
  const chain: Array<{ id: string | null; label: string }> = [{ id: nodeId, label }];
  const seen = new Set<string>([nodeId]);
  let cur = nodeId;
  for (let i = 0; i < 30; i++) {
    const parents = await fetchNodeParents(graphId, cur);
    const p = parents.find((x) => !seen.has(x.id));
    if (!p || (rootNodeId && p.id === rootNodeId)) break; // root はプレフィックスで足す
    seen.add(p.id);
    chain.unshift({ id: p.id, label: labelOf(p) });
    cur = p.id;
  }
  if (rootNodeId) chain.unshift({ id: rootNodeId, label: 'ルート' });
  return chain;
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

// ノードの関係(line)行の並び順を明示配列で保存（h_node_relation チェーンを貼り直す）。
export async function apiReorderNodeRelations(graphId: string, nodeId: string, order: string[]): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/lines/order`, {
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
