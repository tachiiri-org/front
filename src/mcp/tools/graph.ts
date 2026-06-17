import { authorizeFetch, type AuthorizeEnv } from "../../session";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// --- API helpers ---

function tenantCtx(env: AuthorizeEnv) {
  return env.actor?.tenant ? { tenantId: env.actor.tenant } : undefined;
}

async function graphFetch(
  env: AuthorizeEnv,
  graphId: string,
  resource: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  return authorizeFetch(env, {
    path: `/api/v1/graph/${encodeURIComponent(graphId)}/${resource}`,
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    tenantContext: tenantCtx(env),
  });
}

type ApiNode = { id: string; en?: string | null; ja?: string | null; color?: string | null };

async function getBookmarks(env: AuthorizeEnv, graphId: string): Promise<string[]> {
  const res = await graphFetch(env, graphId, "bookmarks");
  if (!res.ok) throw new Error(`get_bookmarks_failed:${res.status}`);
  const data = (await res.json()) as { bookmarks: string[] };
  return data.bookmarks ?? [];
}

async function getNodesByIds(env: AuthorizeEnv, graphId: string, ids: string[]): Promise<ApiNode[]> {
  if (ids.length === 0) return [];
  const include = ids.slice(0, 200).join(",");
  const res = await graphFetch(env, graphId, `nodes?include=${encodeURIComponent(include)}&onlyIncluded=true`);
  if (!res.ok) throw new Error(`get_nodes_failed:${res.status}`);
  const data = (await res.json()) as { nodes: ApiNode[] };
  return data.nodes ?? [];
}

async function getNeighbors(env: AuthorizeEnv, graphId: string, nodeId: string, depth: number): Promise<ApiNode[]> {
  const res = await graphFetch(env, graphId, `node/${encodeURIComponent(nodeId)}/neighbors?depth=${depth}`);
  if (!res.ok) throw new Error(`get_neighbors_failed:${res.status}`);
  const data = (await res.json()) as { nodes: ApiNode[] };
  return data.nodes ?? [];
}

function clampDepth(raw: unknown): number {
  const n = typeof raw === "number" ? Math.floor(raw) : 2;
  return Math.min(Math.max(Number.isFinite(n) ? n : 2, 0), 5);
}

const nodeLabel = (n: ApiNode): string => [n.en, n.ja].filter(Boolean).join(" / ");
const nodeLine = (n: ApiNode): string => `[${n.id}] ${nodeLabel(n)}`;

// --- Tool definitions ---

export const GRAPH_TOOLS = [
  {
    name: "graph_read_words",
    description: "Read bookmarked nodes — the entry-point concepts ('words') of the graph. Returns id and label for each bookmark.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
      },
      required: ["graph_id"],
    },
  },
  {
    name: "graph_read_texts_by_word",
    description:
      "Traverse the graph from a bookmarked node whose label matches `word`, returning all nodes reachable within `depth` hops (default 2, max 5). Loop-safe.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        word: { type: "string", description: "en or ja label of a bookmarked node to start from" },
        depth: { type: "number", description: "Hops to traverse (default 2, max 5)" },
      },
      required: ["graph_id", "word"],
    },
  },
  {
    name: "graph_read_nodes_from",
    description:
      "Traverse the graph from any node ID, returning all nodes reachable within `depth` hops (default 2, max 5). Use this when the user provides a node ID copied from the graph editor.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "Starting node ID" },
        depth: { type: "number", description: "Hops to traverse (default 2, max 5)" },
      },
      required: ["graph_id", "node_id"],
    },
  },
];

// --- Tool handler ---

export async function callGraphTool(
  name: string,
  args: Record<string, unknown>,
  env: AuthorizeEnv,
): Promise<ToolResult> {
  try {
    const graphId = String(args.graph_id);

    if (name === "graph_read_words") {
      const ids = await getBookmarks(env, graphId);
      if (ids.length === 0) return { content: [{ type: "text", text: "(no bookmarks)" }] };
      const nodes = await getNodesByIds(env, graphId, ids);
      const text = nodes.map(nodeLine).join("\n") || "(no labels)";
      return { content: [{ type: "text", text }] };
    }

    if (name === "graph_read_texts_by_word") {
      const word = String(args.word);
      const depth = clampDepth(args.depth);

      const ids = await getBookmarks(env, graphId);
      const bookmarks = await getNodesByIds(env, graphId, ids);
      const match = bookmarks.find((n) => n.en === word || n.ja === word);
      if (!match) {
        return { content: [{ type: "text", text: `No bookmark found matching: ${word}` }], isError: true };
      }

      const nodes = await getNeighbors(env, graphId, match.id, depth);
      const text = nodes.map(nodeLine).join("\n") || "(no nodes)";
      return { content: [{ type: "text", text }] };
    }

    if (name === "graph_read_nodes_from") {
      const nodeId = String(args.node_id);
      const depth = clampDepth(args.depth);
      const nodes = await getNeighbors(env, graphId, nodeId, depth);
      const text = nodes.map(nodeLine).join("\n") || "(no nodes)";
      return { content: [{ type: "text", text }] };
    }

    return { content: [{ type: "text", text: `Unknown graph tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: String(e) }], isError: true };
  }
}
