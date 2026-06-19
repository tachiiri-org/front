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

type ApiNode = { id: string; en?: string | null; ja?: string | null; color?: string | null; node_type?: string | null };

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

async function getNeighborsByWord(env: AuthorizeEnv, graphId: string, word: string, depth: number): Promise<ApiNode[] | null> {
  const res = await graphFetch(env, graphId, `neighbors?word=${encodeURIComponent(word)}&depth=${depth}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get_neighbors_by_word_failed:${res.status}`);
  const data = (await res.json()) as { nodes: ApiNode[] };
  return data.nodes ?? [];
}

function clampDepth(raw: unknown): number {
  const n = typeof raw === "number" ? Math.floor(raw) : 2;
  return Math.min(Math.max(Number.isFinite(n) ? n : 2, 0), 5);
}

const nodeLabel = (n: ApiNode): string => [n.en, n.ja].filter(Boolean).join(" / ");
const nodeLine = (n: ApiNode): string =>
  `[${n.id}] ${nodeLabel(n)}${n.node_type ? ` {node_type=${n.node_type}}` : ""}`;

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
  {
    name: "graph_add_node",
    description: "Create a new node in the graph. Returns the new node id. Optionally connects the new node to a parent.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        ja: { type: "string", description: "Japanese label (required)" },
        en: { type: "string", description: "English label (optional)" },
        parent_node_id: { type: "string", description: "Connect to this parent node on creation (optional)" },
      },
      required: ["graph_id", "ja"],
    },
  },
  {
    name: "graph_update_node",
    description: "Update a node's Japanese and/or English label. Pass null to remove a label.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "Node ID to update" },
        ja: { type: "string", description: "New Japanese label (null to remove)" },
        en: { type: "string", description: "New English label (null to remove)" },
      },
      required: ["graph_id", "node_id"],
    },
  },
  {
    name: "graph_delete_node",
    description: "Delete a node and all its edges from the graph.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "Node ID to delete" },
      },
      required: ["graph_id", "node_id"],
    },
  },
  {
    name: "graph_toggle_link",
    description:
      "Toggle an edge between two nodes. Creates the edge if absent, deletes it if present. Returns {linked:true} when the edge now exists. For reliable (non-toggle) link operations use graph_link / graph_unlink instead.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "One endpoint of the edge" },
        target_node_id: { type: "string", description: "The other endpoint" },
      },
      required: ["graph_id", "node_id", "target_node_id"],
    },
  },
  {
    name: "graph_link",
    description:
      "Idempotently create an edge between two nodes. Does nothing if the edge already exists. Use this instead of graph_toggle_link when you want to ensure an edge exists without risking accidental deletion.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "One endpoint of the edge" },
        target_node_id: { type: "string", description: "The other endpoint" },
      },
      required: ["graph_id", "node_id", "target_node_id"],
    },
  },
  {
    name: "graph_unlink",
    description:
      "Idempotently delete an edge between two nodes. Does nothing if the edge does not exist. Use this instead of graph_toggle_link when you want to ensure an edge is removed without risking accidental creation.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "One endpoint of the edge" },
        target_node_id: { type: "string", description: "The other endpoint" },
      },
      required: ["graph_id", "node_id", "target_node_id"],
    },
  },
  {
    name: "graph_set_property",
    description: "Upsert a key-value metadata property on a node (e.g. key='node_type', value='rule').",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "Target node ID" },
        key: { type: "string", description: "Property key (e.g. 'node_type', 'status')" },
        value: { type: "string", description: "Property value" },
      },
      required: ["graph_id", "node_id", "key", "value"],
    },
  },
  {
    name: "graph_remove_property",
    description: "Remove a metadata property from a node by key.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "Target node ID" },
        key: { type: "string", description: "Property key to remove" },
      },
      required: ["graph_id", "node_id", "key"],
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
      const nodes = await getNeighborsByWord(env, graphId, word, depth);
      if (nodes === null) {
        return { content: [{ type: "text", text: `No bookmark found matching: ${word}` }], isError: true };
      }
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

    if (name === "graph_add_node") {
      const ja = String(args.ja);
      const en = args.en ? String(args.en) : undefined;
      const parentNodeId = args.parent_node_id ? String(args.parent_node_id) : undefined;
      const body: Record<string, unknown> = { ja };
      if (en) body.en = en;
      if (parentNodeId) body.parentId = parentNodeId;
      const res = await graphFetch(env, graphId, "node", "POST", body);
      if (!res.ok) throw new Error(`add_node_failed:${res.status}`);
      const data = (await res.json()) as { id: string; en?: string; ja?: string };
      return { content: [{ type: "text", text: `Created [${data.id}] ${[data.en, data.ja].filter(Boolean).join(" / ")}` }] };
    }

    if (name === "graph_update_node") {
      const nodeId = String(args.node_id);
      const body: Record<string, unknown> = {};
      if (args.ja !== undefined) body.ja = args.ja;
      if (args.en !== undefined) body.en = args.en;
      const res = await graphFetch(env, graphId, `node/${encodeURIComponent(nodeId)}`, "PATCH", body);
      if (!res.ok) throw new Error(`update_node_failed:${res.status}`);
      return { content: [{ type: "text", text: `Updated [${nodeId}]` }] };
    }

    if (name === "graph_delete_node") {
      const nodeId = String(args.node_id);
      const res = await graphFetch(env, graphId, `node/${encodeURIComponent(nodeId)}`, "DELETE");
      if (!res.ok) throw new Error(`delete_node_failed:${res.status}`);
      return { content: [{ type: "text", text: `Deleted [${nodeId}]` }] };
    }

    if (name === "graph_toggle_link") {
      const nodeId = String(args.node_id);
      const targetId = String(args.target_node_id);
      const res = await graphFetch(env, graphId, `node/${encodeURIComponent(nodeId)}/link`, "POST", { targetId });
      if (!res.ok) throw new Error(`toggle_link_failed:${res.status}`);
      const data = (await res.json()) as { linked: boolean };
      return { content: [{ type: "text", text: data.linked ? `Linked [${nodeId}] ↔ [${targetId}]` : `Unlinked [${nodeId}] ↔ [${targetId}]` }] };
    }

    if (name === "graph_link") {
      const nodeId = String(args.node_id);
      const targetId = String(args.target_node_id);
      const res = await graphFetch(env, graphId, "link", "POST", { node_id: nodeId, target_node_id: targetId });
      if (!res.ok) throw new Error(`graph_link_failed:${res.status}`);
      return { content: [{ type: "text", text: `Linked [${nodeId}] ↔ [${targetId}]` }] };
    }

    if (name === "graph_unlink") {
      const nodeId = String(args.node_id);
      const targetId = String(args.target_node_id);
      const res = await graphFetch(env, graphId, "link", "DELETE", { node_id: nodeId, target_node_id: targetId });
      if (!res.ok) throw new Error(`graph_unlink_failed:${res.status}`);
      return { content: [{ type: "text", text: `Unlinked [${nodeId}] ↔ [${targetId}]` }] };
    }

    if (name === "graph_set_property") {
      const nodeId = String(args.node_id);
      const key = String(args.key);
      const value = String(args.value);
      const res = await graphFetch(env, graphId, `node/${encodeURIComponent(nodeId)}/property`, "POST", { key, value });
      if (!res.ok) throw new Error(`set_property_failed:${res.status}`);
      return { content: [{ type: "text", text: `Set [${nodeId}] ${key}=${value}` }] };
    }

    if (name === "graph_remove_property") {
      const nodeId = String(args.node_id);
      const key = String(args.key);
      const res = await graphFetch(env, graphId, `node/${encodeURIComponent(nodeId)}/property/${encodeURIComponent(key)}`, "DELETE");
      if (!res.ok) throw new Error(`remove_property_failed:${res.status}`);
      return { content: [{ type: "text", text: `Removed [${nodeId}] ${key}` }] };
    }

    return { content: [{ type: "text", text: `Unknown graph tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: String(e) }], isError: true };
  }
}
