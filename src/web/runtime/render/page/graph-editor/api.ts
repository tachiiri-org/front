import type { CtxBlock, ExplorerNode, ExplorerRelation } from './types';

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

// ── Session-expiry handling ────────────────────────────────────────────────
// A 401 means the login expired (identity cookies gone) while the tab stayed open. A silent hard
// redirect to /login would discard the user's unsaved edits without warning — and until the redirect
// lands, every queued write keeps failing. Instead we flip an "expired" latch once: the first 401
// fires a handler (the editor shows a login notice), and every later request short-circuits with a
// synthetic 401 so we neither hit the network nor spam retries. The handler owns the UX (banner +
// link to /login); this module just detects and announces the condition.
let sessionExpired = false;
let onExpire: (() => void) | null = null;
export function onSessionExpired(cb: () => void): void { onExpire = cb; }
export function isSessionExpired(): boolean { return sessionExpired; }
function markExpired(): void {
  if (sessionExpired) return;
  sessionExpired = true;
  try { onExpire?.(); } catch { /* handler must never break the fetch path */ }
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  // Once the session is known-expired, stop issuing requests — return a synthetic 401 so callers
  // take their not-ok path without touching the network or re-triggering the notice.
  if (sessionExpired) return new Response(null, { status: 401 });
  // keepalive requests fire during page unload (reorder flush) — never queue/delay them.
  if (init?.keepalive) {
    const r = await fetch(input, init);
    if (r.status === 401) { markExpired(); }
    return r;
  }
  await acquire();
  try {
    const r = await fetch(input, init);
    if (r.status === 401) { markExpired(); }
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

// Create a node (flat: the graph is a flat node list + relation lines, so there is no parent).
export async function apiCreateNode(
  graphId: string, lang: 'en' | 'ja', label: string,
): Promise<ExplorerNode | null> {
  const body = label ? (lang === 'en' ? { en: label } : { ja: label }) : {};
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

// ノード削除。戻り値 ok=false は削除が拒否されたことを表す。relationCount>0 なら「関係テキストが
// 紐づくため削除不可」（バックエンドの 409 ガード）。呼び出し側は楽観的に消した UI を戻す。
export async function apiDeleteNode(
  graphId: string, nodeId: string,
): Promise<{ ok: boolean; relationCount?: number }> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}`, { method: 'DELETE' });
  if (r.ok) return { ok: true };
  if (r.status === 409) {
    const data = await r.json().catch(() => ({})) as { relationCount?: number };
    return { ok: false, relationCount: data.relationCount };
  }
  return { ok: false };
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

// ── 関係 line (relation line) ────────────────────────────────────────────────
// A relation line is an n-ary edge that carries free-text prose (body) connecting its participant
// nodes (ordered; head = subject). See backend p_line_body / h_ray.

// ノードが参加している関係 line 一覧（本文＋順序付き参加者）。ツリー枝は含まれない。
export async function fetchNodeRelations(graphId: string, nodeId: string): Promise<ExplorerRelation[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/lines`);
  if (!r.ok) return [];
  const data = await r.json() as { lines: ExplorerRelation[] };
  return data.lines ?? [];
}

// フラットモードのパンくず: 階層は無いので「ルート › nodeId」の2段（root 未設定なら nodeId のみ）。
// 起点ノードのラベルは呼び出し側が渡す。lang は互換のため受けるが未使用。
export async function fetchNodePath(
  _graphId: string, nodeId: string, label: string, rootNodeId: string | null, _lang: 'en' | 'ja',
): Promise<Array<{ id: string | null; label: string }>> {
  const chain: Array<{ id: string | null; label: string }> = [{ id: nodeId, label }];
  if (rootNodeId && rootNodeId !== nodeId) chain.unshift({ id: rootNodeId, label: 'ルート' });
  return chain;
}

// nodeId を主語（先頭参加者）にした関係 line を新規作成。
export async function apiCreateRelation(
  graphId: string, nodeId: string, lang: 'en' | 'ja', body?: string,
): Promise<ExplorerRelation | null> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/relation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, ...(body ? { body } : {}) }),
  });
  if (!r.ok) return null;
  return r.json() as Promise<ExplorerRelation>;
}

// 貼り付けの複数行を1リクエストで一括作成（サーバ側で [[名前]] 解決/新規ノード作成＋関係作成＋ray）。
// 大量ペーストでも write レート制限(60/60s)に当たらないよう、行ごとの多数の書き込みを1リクエストに畳む。
// subjectId を各行の主語(参加者)に。返りは作成順の関係一覧（body・participants はラベル解決済み）。
export async function apiPasteRelations(
  graphId: string, lang: 'en' | 'ja', subjectId: string | null, lines: string[],
): Promise<ExplorerRelation[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/paste`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, ...(subjectId ? { subjectId } : {}), lines }),
  });
  if (!r.ok) return [];
  const data = await r.json() as { lines?: ExplorerRelation[] };
  return data.lines ?? [];
}

// 関係 line の本文を言語ごとに設定（空文字でも行は残り、関係 line のマークは保持）。
export async function apiSetRelationText(graphId: string, lineId: string, lang: 'en' | 'ja', body: string): Promise<void> {
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

// 関係(line)行のアウトライン階層（インデント深さ）をノード別に保存。
export async function apiSetRelationLevel(graphId: string, nodeId: string, lineId: string, level: number): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/line/${lineId}/level`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level }),
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
export async function fetchOrphanRelations(graphId: string): Promise<ExplorerRelation[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/orphan-lines`);
  if (!r.ok) return [];
  const data = await r.json() as { lines: ExplorerRelation[] };
  return data.lines ?? [];
}

// 関係(line)を丸ごと削除（チップ削除とは別の、関係そのものの削除）。
export async function apiDeleteRelation(graphId: string, lineId: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/line/${lineId}`, { method: 'DELETE' });
}

// ── コンテキスト ((node, relation) の注釈) ───────────────────────────────────
// (node, line) の複合キーに紐づく非規範テキストブロックの順序付きリスト。バックエンド
// /node/:id/line/:lineId/context 系に対応。定義(line)は共有・単一だが注釈はノード別。

// (node, line) のコンテキスト（テキストブロック列）を取得。
export async function fetchLineContext(graphId: string, nodeId: string, lineId: string): Promise<CtxBlock[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/line/${lineId}/context`);
  if (!r.ok) return [];
  const data = await r.json() as { blocks: CtxBlock[] };
  return data.blocks ?? [];
}

// テキストブロックを末尾に追加。返りは更新後のブロック列。
export async function apiCreateCtxBlock(
  graphId: string, nodeId: string, lineId: string, lang: 'en' | 'ja', body = '',
): Promise<{ blockId: string; blocks: CtxBlock[] } | null> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/line/${lineId}/block`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, body }),
  });
  if (!r.ok) return null;
  return r.json() as Promise<{ blockId: string; blocks: CtxBlock[] }>;
}

// テキストブロックの本文を言語ごとに設定。
export async function apiSetBlockText(graphId: string, blockId: string, lang: 'en' | 'ja', body: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/block/${blockId}/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, body }),
  });
}

// (node, line) のブロック並び順を明示配列で保存。返りは更新後。
export async function apiReorderCtxBlocks(graphId: string, nodeId: string, lineId: string, order: string[]): Promise<CtxBlock[]> {
  const r = await apiFetch(`/api/v1/graph/${graphId}/node/${nodeId}/line/${lineId}/blocks/order`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  });
  if (!r.ok) return [];
  const data = await r.json() as { blocks: CtxBlock[] };
  return data.blocks ?? [];
}

// テキストブロックを削除。
export async function apiDeleteBlock(graphId: string, blockId: string): Promise<void> {
  await apiFetch(`/api/v1/graph/${graphId}/block/${blockId}`, { method: 'DELETE' });
}
