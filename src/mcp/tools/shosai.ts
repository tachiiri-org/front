import { authorizeFetch, type AuthorizeEnv } from "../../session";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// ショサイ（書斎）の MCP ツール。
//
// 読む側（一覧・表・ページ・検索）と、ビューの設定（絞り込み・並び）を触れるようにする。
// 取り込みそのものは Notion 側の同意が要る人間の操作なので、ここからは開始しない。
// 本文の編集も外している。文章を書くのは人の仕事で、エージェントが黙って書き換えると
// どこが変わったのか分からなくなる。

function tenantCtx(env: AuthorizeEnv) {
  return env.actor?.tenant ? { tenantId: env.actor.tenant, subjectId: env.actor.userId } : undefined;
}

async function shosaiFetch(
  env: AuthorizeEnv,
  resource: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  return authorizeFetch(env, {
    path: `/api/v1/shosai${resource}`,
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    audience: "backend",
    tenantContext: tenantCtx(env),
  });
}

async function asResult(res: Response): Promise<ToolResult> {
  const text = await res.text();
  if (!res.ok) {
    return { content: [{ type: "text", text: `error ${res.status}: ${text.slice(0, 500)}` }], isError: true };
  }
  return { content: [{ type: "text", text }] };
}

export const SHOSAI_TOOLS = [
  {
    name: "shosai_list_databases",
    description:
      "List the databases in 書斎 (shosai) with their row and column counts. Databases imported from Notion carry notionSourceId; the import log carries systemKind='import-log' and cannot be deleted. Start here to find the databaseId you need for the other tools.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "shosai_read_database",
    description:
      "Read one database: its columns (with the Notion property id each came from), its views (name, type, and the raw Notion filter/sorts/quickFilters expressions), and every row with its cell values. Use this before changing a view so you can see which property ids the filter expressions refer to.",
    inputSchema: {
      type: "object",
      properties: { databaseId: { type: "string", description: "From shosai_list_databases" } },
      required: ["databaseId"],
      additionalProperties: false,
    },
  },
  {
    name: "shosai_read_page",
    description:
      "Read one page's blocks in document order, with depth (indent level), type, text, and any attached image/link. Row pages of a database are also pages — pass the row id.",
    inputSchema: {
      type: "object",
      properties: { pageId: { type: "string" } },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  {
    name: "shosai_search",
    description:
      "Full-text search across all block text in 書斎. Queries of 3+ characters use an FTS5 trigram index; shorter ones fall back to LIKE. The response says which engine ran. Japanese works (the index is trigram, not word-segmented).",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search text" },
        limit: { type: "number", description: "Max hits (default 50)" },
      },
      required: ["q"],
      additionalProperties: false,
    },
  },
  {
    name: "shosai_update_view",
    description:
      "Change a view's filter, sort order, or name. Filters live in quickFilters, keyed by the Notion property id (get them from shosai_read_database), e.g. {\"J<N\\\\\":{\"select\":{\"equals\":\"日記\"}}}. sorts is an array like [{\"property\":\"SzQP\",\"direction\":\"descending\"}]. Pass null to clear one. These expressions are evaluated in 書斎, not sent back to Notion — conditions over properties 書斎 did not import (formula, rollup, people, files) cannot be evaluated and are ignored.",
    inputSchema: {
      type: "object",
      properties: {
        viewId: { type: "string", description: "From shosai_read_database" },
        quickFilters: { description: "Object keyed by Notion property id, or null to clear" },
        sorts: { description: "Array of {property, direction}, or null to clear" },
        name: { type: "string" },
        type: { type: "string", description: "table | board | calendar | list | gallery" },
      },
      required: ["viewId"],
      additionalProperties: false,
    },
  },
  {
    name: "shosai_read_settings",
    description:
      "Read 書斎's settings. timezone decides how relative date filters (past_week, this_week…) in views are resolved.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "shosai_save_settings",
    description:
      "Change 書斎's settings. Currently only timezone (an IANA name such as Asia/Tokyo).",
    inputSchema: {
      type: "object",
      properties: { timezone: { type: "string", description: "IANA timezone, e.g. Asia/Tokyo" } },
      additionalProperties: false,
    },
  },
  {
    name: "shosai_import_progress",
    description:
      "Read the progress and recorded failures of a Notion import for one database: phase, rows imported so far, and what could not be imported (with the Notion block id). Also see the 「Notion 取り込みログ」 database for the same failures as browsable rows.",
    inputSchema: {
      type: "object",
      properties: { databaseId: { type: "string" } },
      required: ["databaseId"],
      additionalProperties: false,
    },
  },
];

export async function callShosaiTool(
  name: string,
  args: Record<string, unknown>,
  env: AuthorizeEnv,
): Promise<ToolResult> {
  switch (name) {
    case "shosai_list_databases":
      return asResult(await shosaiFetch(env, "/databases"));
    case "shosai_read_database":
      return asResult(await shosaiFetch(env, `/database/${encodeURIComponent(String(args.databaseId ?? ""))}`));
    case "shosai_read_page":
      return asResult(await shosaiFetch(env, `/page/${encodeURIComponent(String(args.pageId ?? ""))}`));
    case "shosai_search": {
      const q = encodeURIComponent(String(args.q ?? ""));
      const limit = args.limit ? `&limit=${Number(args.limit)}` : "";
      return asResult(await shosaiFetch(env, `/search?q=${q}${limit}`));
    }
    case "shosai_update_view": {
      const { viewId, ...patch } = args;
      return asResult(await shosaiFetch(env, `/view/${encodeURIComponent(String(viewId ?? ""))}`, "PUT", patch));
    }
    case "shosai_read_settings":
      return asResult(await shosaiFetch(env, "/settings"));
    case "shosai_save_settings":
      return asResult(await shosaiFetch(env, "/settings", "PUT", args));
    case "shosai_import_progress":
      return asResult(await shosaiFetch(env,
        `/notion/progress?databaseId=${encodeURIComponent(String(args.databaseId ?? ""))}`));
    default:
      return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
  }
}
