// ショサイ（書斎）の API クライアント。front worker が /api/v1/shosai/* を backend の
// ShosaiDO へ中継する。エラーは呼び出し側で握り潰さず、画面上に出すために投げ直す。

export type BlockType =
  | 'page' | 'paragraph' | 'heading' | 'todo' | 'code' | 'quote' | 'bullet' | 'numbered' | 'divider' | 'database';

export type PropertyType =
  | 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'multi_select' | 'relation';

export interface PageSummary { id: string; title: string; updated_at: number | null }
export interface BlockRow { id: string; depth: number; type: BlockType; text: string; rank: string | null }
export interface PageDetail {
  page: { id: string; type: BlockType; title: string; created_at: number | null; updated_at: number | null };
  blocks: BlockRow[];
}
export interface PropertyDef { id: string; name: string; type: PropertyType; rank: string | null }
export interface OptionDef { id: string; name: string }
export interface ViewDef { id: string; type: string; name: string }
export interface DatabaseSummary {
  databaseId: string; blockId: string | null; title: string; rowCount: number; propertyCount: number;
}
export interface DatabaseDetail {
  databaseId: string;
  properties: PropertyDef[];
  views: ViewDef[];
  rows: Array<{ id: string; title: string; cells: Record<string, unknown> }>;
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
export const readDatabase = (id: string): Promise<DatabaseDetail> => call(`/database/${encodeURIComponent(id)}`);

export const createDatabase = (body: { title: string; parentId?: string }):
  Promise<{ databaseId: string; blockId: string; viewId: string }> => post('/database', body);

export const addProperty = (databaseId: string, body: { name: string; type: PropertyType; options?: string[] }):
  Promise<{ propertyId: string; options: OptionDef[] }> =>
  post(`/database/${encodeURIComponent(databaseId)}/property`, body);

export const addRow = (databaseId: string, body: { title: string; parentId?: string }):
  Promise<{ blockId: string }> => post(`/database/${encodeURIComponent(databaseId)}`, body);

export const setCell = (body: { blockId: string; propertyId: string; value: unknown }): Promise<unknown> =>
  put('/cell', body);
