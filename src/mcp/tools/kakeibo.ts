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
    name: "kakeibo_read_summary",
    description:
      "Cross-month totals: 費目 (category) x 請求年月, and 店 (shop) x 請求年月. Use this to answer questions like 'how much did I spend on 食費 last month' or 'which shop grew the most' without reading every statement row. Categories are folded to one per shop (name order) so the totals sum to the real spend — a shop with several 費目 would otherwise be counted twice.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "kakeibo_list_fixed",
    description:
      "List the manually entered money movements: recurring ones (家賃 and other monthly fixed amounts) and one-off ones (学費, 固定資産税, salary…). These are bank-debit / income items kept apart from the credit-card statements, so a card re-import never touches them.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "kakeibo_set_recurring",
    description:
      "Define a monthly fixed amount (家賃 etc.) or a recurring income. It is entered once and counted into every month from start_month until end_month (or until the latest month with data). Use this instead of adding one entry per month. Pass id to update an existing definition — omit it to create.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Existing recurring id to update; omit to create" },
        kind: { type: "string", enum: ["expense", "income"], description: "既定は expense" },
        label: { type: "string", description: "名称。例: '家賃'" },
        amount: { type: "number", description: "毎月の金額（円）" },
        start_month: { type: "string", description: "開始月 YYYY-MM" },
        end_month: { type: "string", description: "終了月 YYYY-MM。継続中なら省略" },
        categories: { type: "array", items: { type: "string" }, description: "費目。カード明細と共通" },
      },
      required: ["label", "amount", "start_month"],
    },
  },
  {
    name: "kakeibo_set_entry",
    description:
      "Record a one-off amount for a single month — 学費, 固定資産税, a salary payment, anything whose amount differs each time. Pass id to update an existing record; omit it to create.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Existing entry id to update; omit to create" },
        kind: { type: "string", enum: ["expense", "income"], description: "既定は expense" },
        label: { type: "string", description: "名称。例: '固定資産税'" },
        amount: { type: "number", description: "金額（円）" },
        occurred_month: { type: "string", description: "発生月 YYYY-MM" },
        note: { type: "string" },
        categories: { type: "array", items: { type: "string" }, description: "費目。カード明細と共通" },
      },
      required: ["label", "amount", "occurred_month"],
    },
  },
  {
    name: "kakeibo_delete_fixed",
    description: "Delete a recurring definition or a one-off record by id.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["recurring", "entry"] },
        id: { type: "string" },
      },
      required: ["kind", "id"],
    },
  },
  {
    name: "kakeibo_backup",
    description:
      "Dump this tenant's kakeibo data to R2 and return the object key. Use it to copy production data down to dev/stage: run this on production, then call kakeibo_restore with the same key on the lower environment. The dump carries its own schema, so it loads even if the two environments' code differ.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "kakeibo_restore",
    description:
      "Rebuild this tenant's kakeibo data from an R2 dump key produced by kakeibo_backup. Destructive: every dumped table is dropped and reloaded, inside one transaction. Refused on production — production is the source of truth and must never be a restore target.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", description: "R2 object key from kakeibo_backup" } },
      required: ["key"],
    },
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

  if (name === "kakeibo_backup") {
    return asResult(await kakeiboFetch(env, "/admin/backup-do", "POST"));
  }

  if (name === "kakeibo_restore") {
    const key = String(args.key ?? "");
    if (!key) return { content: [{ type: "text", text: "key is required" }], isError: true };
    return asResult(await kakeiboFetch(env, `/admin/restore-do?key=${encodeURIComponent(key)}`, "POST"));
  }

  if (name === "kakeibo_list_fixed") {
    return asResult(await kakeiboFetch(env, "/fixed"));
  }

  if (name === "kakeibo_set_recurring") {
    const body = {
      kind: args.kind, label: args.label, amount: args.amount,
      startMonth: args.start_month, endMonth: args.end_month ?? null,
      categories: Array.isArray(args.categories) ? args.categories.map((c) => String(c)) : undefined,
    };
    const id = args.id ? String(args.id) : "";
    return asResult(await kakeiboFetch(env, id ? `/fixed/recurring/${encodeURIComponent(id)}` : "/fixed/recurring",
      id ? "PUT" : "POST", body));
  }

  if (name === "kakeibo_set_entry") {
    const body = {
      kind: args.kind, label: args.label, amount: args.amount,
      occurredMonth: args.occurred_month, note: args.note,
      categories: Array.isArray(args.categories) ? args.categories.map((c) => String(c)) : undefined,
    };
    const id = args.id ? String(args.id) : "";
    return asResult(await kakeiboFetch(env, id ? `/fixed/entry/${encodeURIComponent(id)}` : "/fixed/entry",
      id ? "PUT" : "POST", body));
  }

  if (name === "kakeibo_delete_fixed") {
    const kind = String(args.kind ?? "");
    const id = String(args.id ?? "");
    if (!id || (kind !== "recurring" && kind !== "entry")) {
      return { content: [{ type: "text", text: "kind must be recurring|entry and id is required" }], isError: true };
    }
    return asResult(await kakeiboFetch(env, `/fixed/${kind}/${encodeURIComponent(id)}`, "DELETE"));
  }

  if (name === "kakeibo_read_summary") {
    return asResult(await kakeiboFetch(env, "/summary"));
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
