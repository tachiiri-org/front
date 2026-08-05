import { authorizeFetch, type AuthorizeEnv } from "../../session";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// プロダクト横断のデータ持ち出し／持ち込み。graph / uranai / kakeibo で同じ操作なので
// プロダクトごとにツールを増やさず、product を引数に取る1組にまとめる。
const PRODUCTS = ["graph", "uranai", "kakeibo"] as const;
type Product = (typeof PRODUCTS)[number];

function tenantCtx(env: AuthorizeEnv) {
  return env.actor?.tenant ? { tenantId: env.actor.tenant, subjectId: env.actor.userId } : undefined;
}

export const PRODUCT_TOOLS = [
  {
    name: "product_backup",
    description:
      "Dump one product's tenant database (Durable Object SQLite) to R2 and return the object key. This is the first step of copying production data down to dev/stage: back up on production, move the object to the lower environment's bucket with authorize_r2_s3 / r2_file_copy, then call product_restore there. The dump carries its own schema, so it loads even when the two environments run different code.",
    inputSchema: {
      type: "object",
      properties: { product: { type: "string", enum: [...PRODUCTS] } },
      required: ["product"],
    },
  },
  {
    name: "product_restore",
    description:
      "Rebuild one product's tenant database from an R2 dump key. Destructive: every dumped table is dropped and reloaded inside a single transaction. Refused on production — restore copies an upstream environment down into a disposable one, and production is the source of truth.",
    inputSchema: {
      type: "object",
      properties: {
        product: { type: "string", enum: [...PRODUCTS] },
        key: { type: "string", description: "R2 object key from product_backup" },
      },
      required: ["product", "key"],
    },
  },
] as const;

export async function callProductTool(
  name: string,
  args: Record<string, unknown>,
  env: AuthorizeEnv,
): Promise<ToolResult> {
  const product = String(args.product ?? "");
  if (!PRODUCTS.includes(product as Product)) {
    return { content: [{ type: "text", text: `product must be one of ${PRODUCTS.join("|")}` }], isError: true };
  }

  const run = async (path: string): Promise<ToolResult> => {
    const res = await authorizeFetch(env, {
      path,
      method: "POST",
      audience: "backend",
      tenantContext: tenantCtx(env),
    });
    const text = await res.text();
    if (!res.ok) {
      return { content: [{ type: "text", text: `error ${res.status}: ${text.slice(0, 500)}` }], isError: true };
    }
    return { content: [{ type: "text", text }] };
  };

  if (name === "product_backup") return run(`/api/v1/${product}/admin/backup-do`);

  if (name === "product_restore") {
    const key = String(args.key ?? "");
    if (!key) return { content: [{ type: "text", text: "key is required" }], isError: true };
    return run(`/api/v1/${product}/admin/restore-do?key=${encodeURIComponent(key)}`);
  }

  return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
}
