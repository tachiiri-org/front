import { authorizeFetch, type AuthorizeEnv } from "../../session";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// 家計簿の MCP ツール。
//
// 明細そのものは請求年月ごとの全削除・全追加で入れ替わるため、エージェントに触らせない。
// 触れるのは「店に費目と略名を付ける」という、取り込みを跨いで残る部分だけ。
// 明細に安定した取引IDが無いので、行単位の編集は原理的に安定しない。

function tenantCtx(env: AuthorizeEnv) {
  return env.actor?.tenant ? { tenantId: env.actor.tenant, subjectId: env.actor.userId } : undefined;
}

async function kakeiboFetch(
  env: AuthorizeEnv,
  resource: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  return authorizeFetch(env, {
    path: `/api/v1/kakeibo${resource}`,
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

export const KAKEIBO_TOOLS = [
  {
    name: "kakeibo_list_shops",
    description:
      "List every shop seen in the imported credit-card statements, with its current alias (短い表示名) and 費目 (categories). Use this before assigning categories so you can see what is already set and reuse existing 費目 names instead of inventing near-duplicates.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "kakeibo_list_months",
    description:
      "List the billing months (請求年月, YYYY-MM) that have imported statements.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "kakeibo_read_statements",
    description:
      "Read the statement rows of one billing month (請求年月). Returns each row with its shop, alias, 費目, amount and remark, plus the latest import's totals. Read-only: rows are replaced wholesale on every import, so they must not be edited individually.",
    inputSchema: {
      type: "object",
      properties: {
        billing_month: { type: "string", description: "請求年月 (YYYY-MM), e.g. '2026-08'" },
      },
      required: ["billing_month"],
    },
  },
  {
    name: "kakeibo_set_shop",
    description:
      "Set a shop's 費目 (categories) and/or 略名 (short display name). This is the one mutation the agent may perform: it attaches to the shop, not to a statement row, so it survives the wholesale re-import of a month. Call kakeibo_list_shops first and reuse existing 費目 names — creating '食費' and '食料品' separately fragments the totals. Pass an empty array to clear all 費目, or an empty string to clear the alias.",
    inputSchema: {
      type: "object",
      properties: {
        shop_id: { type: "string", description: "Shop id from kakeibo_list_shops" },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "費目 names, e.g. ['食費']. Replaces the existing set.",
        },
        alias: { type: "string", description: "略名, e.g. 'ライフ'. Empty string clears it." },
      },
      required: ["shop_id"],
    },
  },
] as const;

export async function callKakeiboTool(
  name: string,
  args: Record<string, unknown>,
  env: AuthorizeEnv,
): Promise<ToolResult> {
  if (name === "kakeibo_list_shops") {
    return asResult(await kakeiboFetch(env, "/shops"));
  }

  if (name === "kakeibo_list_months") {
    return asResult(await kakeiboFetch(env, "/months"));
  }

  if (name === "kakeibo_read_statements") {
    const bm = String(args.billing_month ?? "");
    if (!/^\d{4}-\d{2}$/.test(bm)) {
      return { content: [{ type: "text", text: "billing_month must be YYYY-MM" }], isError: true };
    }
    return asResult(await kakeiboFetch(env, `/statements?billingMonth=${encodeURIComponent(bm)}`));
  }

  if (name === "kakeibo_set_shop") {
    const shopId = String(args.shop_id ?? "");
    if (!shopId) {
      return { content: [{ type: "text", text: "shop_id is required" }], isError: true };
    }
    const body: { categories?: string[]; alias?: string } = {};
    if (Array.isArray(args.categories)) body.categories = args.categories.map((c) => String(c));
    if (typeof args.alias === "string") body.alias = args.alias;
    if (body.categories === undefined && body.alias === undefined) {
      return { content: [{ type: "text", text: "nothing to update: pass categories and/or alias" }], isError: true };
    }
    return asResult(await kakeiboFetch(env, `/shops/${encodeURIComponent(shopId)}`, "PUT", body));
  }

  return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
}
