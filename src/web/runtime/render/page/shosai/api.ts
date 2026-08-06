// ショサイ（書斎）の API クライアント。front worker が /api/v1/shosai/* を backend の
// ShosaiDO へ中継する。エラーは呼び出し側で握り潰さず、画面上に出すために投げ直す。

export type BlockType =
  | 'page' | 'paragraph' | 'heading' | 'todo' | 'code' | 'quote' | 'bullet' | 'numbered' | 'divider' | 'database'
  | 'image' | 'table' | 'table_row' | 'table_cell' | 'page_link' | 'embed';

export type PropertyType =
  | 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'multi_select' | 'relation';

export interface PageSummary { id: string; title: string; updated_at: number | null }
export interface BlockRow {
  id: string; depth: number; type: BlockType; text: string; rank: string | null;
  /** 画像などの添付。fileUrl があれば外部 URL、無ければ /file/:id から読む。 */
  fileId?: string | null; fileUrl?: string | null;
  /** ページへのリンクの相手。 */
  linkTargetId?: string | null; linkTargetTitle?: string | null;
  /** 埋め込みの行き先。Notion がホストしていたものは fileId 側に入る。 */
  url?: string | null;
}
export interface PageDetail {
  page: { id: string; type: BlockType; title: string; created_at: number | null; updated_at: number | null };
  blocks: BlockRow[];
}
export interface PropertyDef {
  id: string; name: string; type: PropertyType; rank: string | null;
  /** Notion のプロパティ ID。ビューの式がこれで参照する。 */
  notionId?: string | null;
  /** select / multi_select のときだけ入る。画面で選ばせるために使う。 */
  options?: OptionDef[];
}
export interface OptionDef { id: string; name: string; colorId?: string | null }
export interface ViewDef {
  id: string; type: string; name: string;
  /** Notion の式をそのまま預かったもの。画面側で解く。 */
  filter?: string | null; sorts?: string | null;
  /** 絞り込みの実体はこちら（filter は null で来る）。鍵は Notion のプロパティ ID。 */
  quickFilters?: string | null;
  /** 表示する列と幅。 */
  configuration?: string | null;
}
export interface DatabaseSummary {
  databaseId: string; blockId: string | null; title: string; rowCount: number; propertyCount: number;
  /** Notion 由来なら data_source_id が入る。取り込み中は syncStatus が 'running'。 */
  syncStatus?: string | null; syncPhase?: string | null; notionSourceId?: string | null;
  /** 仕組みが持つデータベース（取り込みログなど）。消せず、列も行も足せない。 */
  systemKind?: string | null;
}
export interface DatabaseDetail {
  databaseId: string;
  systemKind?: string | null;
  properties: PropertyDef[];
  views: ViewDef[];
  rows: Array<{
    id: string; title: string; cells: Record<string, unknown>;
    /** Notion 側の作成・更新日時。ビューの並びや絞り込みが参照する。 */
    notionCreatedAt?: number | null; notionEditedAt?: number | null;
  }>;
}
export interface SearchHit { id: string; type: BlockType; text: string }

export class ShosaiApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/shosai${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      detail = body.message ?? body.error ?? detail;
    } catch { /* 本文が JSON でないときはステータスだけ出す */ }
    throw new ShosaiApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown): Promise<T> =>
  call<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export const listPages = (): Promise<{ pages: PageSummary[] }> => call('/pages');
export const readPage = (id: string): Promise<PageDetail> => call(`/page/${encodeURIComponent(id)}`);

export const createBlock = (body: {
  parentId?: string; afterId?: string | null; type?: BlockType; text?: string;
}): Promise<{ id: string }> => post('/block', body);

export const patchBlock = (id: string, body: { text?: string; type?: BlockType }): Promise<{ id: string }> =>
  call(`/block/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });

export const moveBlock = (id: string, body: { parentId: string; afterId?: string | null }): Promise<unknown> =>
  put(`/block/${encodeURIComponent(id)}/move`, body);

export const deleteBlock = (id: string): Promise<{ removed: number }> =>
  call(`/block/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const search = (q: string): Promise<{ results: SearchHit[]; engine: string }> =>
  call(`/search?q=${encodeURIComponent(q)}`);

export const listDatabases = (): Promise<{ databases: DatabaseSummary[] }> => call('/databases');
export const readDatabase = (id: string, viewId?: string): Promise<DatabaseDetail> =>
  call(`/database/${encodeURIComponent(id)}${viewId ? `?viewId=${encodeURIComponent(viewId)}` : ''}`);

export const createDatabase = (body: { title: string; parentId?: string }):
  Promise<{ databaseId: string; blockId: string; viewId: string }> => post('/database', body);

export const addProperty = (databaseId: string, body: { name: string; type: PropertyType; options?: string[] }):
  Promise<{ propertyId: string; options: OptionDef[] }> =>
  post(`/database/${encodeURIComponent(databaseId)}/property`, body);

export const addRow = (databaseId: string, body: { title: string; parentId?: string }):
  Promise<{ blockId: string }> => post(`/database/${encodeURIComponent(databaseId)}`, body);

export const setCell = (body: { blockId: string; propertyId: string; value: unknown }): Promise<unknown> =>
  put('/cell', body);

// ── Notion 連携 ────────────────────────────────────────────────────────────────

export interface NotionConnection {
  connectionId: string;
  workspaceId: string | null;
  workspaceName: string | null;
  connected_at: number | null;
  synced_at: number | null;
  sourceCount: number;
}

export interface NotionSource {
  id: string;          // data_source_id
  title: string;
  databaseId: string;  // Notion 側の database id（データソースの親）
  propertyCount: number;
}

export interface ImportStatus {
  importId: string;
  status: {
    status: string;                 // queued | running | paused | errored | complete ...
    output?: {
      rows?: number;
      blocks?: number;
      dropped?: Record<string, number>;
      unresolvedRelations?: number;
      failed?: string[];
    };
    error?: unknown;
  };
}

export const listConnections = (): Promise<{ connections: NotionConnection[] }> =>
  call('/notion/connections');

export const listSources = (connectionId: string): Promise<{ sources: NotionSource[] }> =>
  call(`/notion/sources?connectionId=${encodeURIComponent(connectionId)}`);

export const startImport = (body: {
  connectionId: string; dataSourceId: string; title: string; includeBody: boolean;
}): Promise<{ importId: string; databaseId: string }> => post('/notion/import', body);

export const importStatus = (importId: string): Promise<ImportStatus> =>
  call(`/notion/import/${encodeURIComponent(importId)}`);

export interface ImportProgress {
  state: {
    databaseId: string; cursor: string | null; synced_at: number | null;
    status: string | null; phase: string | null;
    rows: number | null; blocks: number | null; importId: string | null; updated_at: number | null;
  } | null;
  rowsInDb: number;
  failures: Array<{ seq: number; at: number; notionId: string | null; message: string }>;
}

/** 取り込みの進み具合と失敗。ワークフローの状態と違い、走行中でも中身が読める。 */
export const importProgress = (databaseId: string): Promise<ImportProgress> =>
  call(`/notion/progress?databaseId=${encodeURIComponent(databaseId)}`);

/** リレーションの参照先の候補。その列が指しているデータベースの行を返す。 */
export const relationCandidates = (propertyId: string): Promise<{ pages: Array<{ id: string; title: string }> }> =>
  call(`/relation-candidates?propertyId=${encodeURIComponent(propertyId)}`);

/** relation で指している別データソース。取り込み時にまとめて選ぶために使う。 */
export const relatedSources = (connectionId: string, dataSourceId: string):
  Promise<{ related: Array<{ id: string; title: string }> }> =>
  call(`/notion/related?connectionId=${encodeURIComponent(connectionId)}&dataSourceId=${encodeURIComponent(dataSourceId)}`);

export const deleteDatabase = (databaseId: string): Promise<{ databaseId: string }> =>
  call(`/database/${encodeURIComponent(databaseId)}`, { method: 'DELETE' });

/** 画像などを R2 へ。ブロックに紐づけて置き場所を記録する。 */
export async function uploadFile(blockId: string, file: File): Promise<{ fileId: string }> {
  const q = new URLSearchParams({ blockId, name: file.name });
  const res = await fetch(`/api/v1/shosai/upload?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try { const b = (await res.json()) as { message?: string }; detail = b.message ?? detail; } catch { /* 本文が JSON でない */ }
    throw new ShosaiApiError(res.status, detail);
  }
  return (await res.json()) as { fileId: string };
}

export const readSettings = (): Promise<{ settings: Record<string, string> }> => call('/settings');
export const saveSettings = (patch: Record<string, string>): Promise<unknown> => put('/settings', patch);

/** 取り込みを止める。走っているワークフローを終わらせ、状態も残す。 */
export const cancelImport = (importId: string, databaseId?: string): Promise<unknown> =>
  call(`/notion/import/${encodeURIComponent(importId)}${databaseId ? `?databaseId=${encodeURIComponent(databaseId)}` : ''}`,
    { method: 'DELETE' });
