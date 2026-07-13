import { authorizeFetch, type AuthorizeEnv } from "../../session";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// --- API helpers ---

function tenantCtx(env: AuthorizeEnv) {
  // Carry the MCP token's subject (the authorizing user) alongside the tenant so the
  // backend attributes the operation to that user (責任者) rather than to front.
  return env.actor?.tenant ? { tenantId: env.actor.tenant, subjectId: env.actor.userId } : undefined;
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
    // Propagate the MCP token's scopes so the backend can enforce graph:read/write.
    scopes: env.actor?.scopes,
  });
}

type ApiNode = { id: string; en?: string | null; ja?: string | null; color?: string | null };

async function getNeighbors(
  env: AuthorizeEnv,
  graphId: string,
  nodeId: string,
  depth: number,
  limit?: number,
): Promise<{ nodes: ApiNode[]; truncated?: boolean; count?: number }> {
  const params = new URLSearchParams({ depth: String(depth) });
  if (limit != null) params.set("limit", String(limit));
  const res = await graphFetch(env, graphId, `node/${encodeURIComponent(nodeId)}/neighbors?${params.toString()}`);
  if (!res.ok) throw new Error(`get_neighbors_failed:${res.status}`);
  return res.json() as Promise<{ nodes: ApiNode[]; truncated?: boolean; count?: number }>;
}

async function getNeighborsByWord(
  env: AuthorizeEnv,
  graphId: string,
  word: string,
  depth: number,
  limit?: number,
): Promise<{ nodes: ApiNode[]; truncated?: boolean; count?: number } | null> {
  const params = new URLSearchParams({ depth: String(depth) });
  if (limit != null) params.set("limit", String(limit));
  const res = await graphFetch(env, graphId, `neighbors?word=${encodeURIComponent(word)}&${params.toString()}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get_neighbors_by_word_failed:${res.status}`);
  return res.json() as Promise<{ nodes: ApiNode[]; truncated?: boolean; count?: number }>;
}

function clampDepth(raw: unknown): number {
  const n = typeof raw === "number" ? Math.floor(raw) : 2;
  return Math.min(Math.max(Number.isFinite(n) ? n : 2, 0), 5);
}

const nodeLabel = (n: ApiNode): string => [n.en, n.ja].filter(Boolean).join(" / ");
const nodeLine = (n: ApiNode): string => `[${n.id}] ${nodeLabel(n)}`;

// A relation line as returned by GET /node/:id/lines. `body` is prose per language with node
// references embedded as ⟦nodeId⟧; `participants` carries the id→label mapping to resolve them.
type ApiParticipant = { id: string; en?: string | null; ja?: string | null };
type ApiLine = { lineId: string; body: Record<string, string>; participants: ApiParticipant[] };

async function getNodeLines(env: AuthorizeEnv, graphId: string, nodeId: string): Promise<ApiLine[]> {
  const res = await graphFetch(env, graphId, `node/${encodeURIComponent(nodeId)}/lines`);
  if (!res.ok) throw new Error(`get_node_lines_failed:${res.status}`);
  const data = (await res.json()) as { lines?: ApiLine[] };
  return data.lines ?? [];
}

const participantLabel = (p: ApiParticipant): string => [p.en, p.ja].filter(Boolean).join(" / ") || p.id;

// Replace ⟦nodeId⟧ mentions in a relation body with the referenced node's label, so the prose is
// human/AI-readable instead of raw UUIDs. Unknown ids are left as-is.
function resolveMentions(body: string, byId: Map<string, ApiParticipant>): string {
  return body.replace(/⟦([^⟧]+)⟧/g, (_m, id: string) => {
    const p = byId.get(id);
    return p ? `⟦${participantLabel(p)}⟧` : `⟦${id}⟧`;
  });
}

// Format one relation line: its resolved prose (ja preferred, en fallback/extra) plus participants.
function relationLineText(line: ApiLine): string {
  const byId = new Map(line.participants.map((p) => [p.id, p]));
  const langs = Object.keys(line.body);
  const ordered = [...langs.filter((l) => l === "ja"), ...langs.filter((l) => l !== "ja")];
  const bodies = ordered
    .map((l) => resolveMentions(line.body[l] ?? "", byId).trim())
    .filter((b) => b.length > 0);
  const prose = bodies.length ? bodies.join("\n  ") : "(本文なし)";
  const parts = line.participants.map((p) => `[${p.id}] ${participantLabel(p)}`).join(", ");
  return `● ${prose}\n  関係ノード: ${parts || "(なし)"}`;
}

// A relation line matches `word` if the word appears in any participant label or in any body text.
function lineMatchesWord(line: ApiLine, word: string): boolean {
  const w = word.toLowerCase();
  if (line.participants.some((p) => participantLabel(p).toLowerCase().includes(w))) return true;
  return Object.values(line.body).some((b) => b.toLowerCase().includes(w));
}

// --- Tool definitions ---

export const GRAPH_TOOLS = [
  {
    name: "graph_read_texts_by_word",
    description:
      "Traverse the graph from any node whose label exactly matches `word` (en or ja), returning all nodes reachable within `depth` hops (default 2, max 5). Loop-safe.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        word: { type: "string", description: "Exact en or ja label of any node to start from" },
        depth: { type: "number", description: "Hops to traverse (default 2, max 5)" },
        limit: { type: "number", description: "Max nodes to return (default 100, max 500)." },
      },
      required: ["graph_id", "word"],
    },
  },
  {
    name: "graph_read_nodes_from",
    description:
      "Traverse the graph from any node ID, returning all nodes reachable within `depth` hops (default 2, max 5). Returns `truncated: true` with `count` when the result exceeds the limit (default 100, max 500) — reduce depth to get complete results.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "Starting node ID" },
        depth: { type: "number", description: "Hops to traverse (default 2, max 5)" },
        limit: { type: "number", description: "Max nodes to return (default 100, max 500). If truncated, reduce depth." },
      },
      required: ["graph_id", "node_id"],
    },
  },
  {
    name: "graph_read_relations",
    description:
      "Read the RELATION LINES (リレーション / relation text) a node participates in — the free-text prose in the relation panel, which graph_read_nodes_from does NOT return. Returns each line's body (with ⟦...⟧ node references resolved to labels) and its participant nodes. Use this to load a task/note attached to a node before working on it — e.g. when the user references '[<node-id>]修正', call this with that node_id and word='修正' to pull just the 修正 relation text. `word` (optional) filters to lines whose body or a participant label contains the word; omit it to get all of the node's relations.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "Node whose relation lines to read" },
        word: { type: "string", description: "Optional filter: only lines whose body or a participant label contains this word (e.g. '修正')" },
      },
      required: ["graph_id", "node_id"],
    },
  },
  {
    name: "graph_export",
    description:
      "Export the WHOLE graph in one call: every node (id + label) AND every relation line (prose with ⟦...⟧ resolved to labels, plus its participant nodes). This is the bulk counterpart to the per-node read tools — reach for it when you need full coverage of the graph's definitions/relations (auditing, understanding the whole model, checking what is/isn't captured) instead of sampling node-by-node. For a single node's relations use graph_read_relations; to find where a word appears use graph_search_relations.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
      },
      required: ["graph_id"],
    },
  },
  {
    name: "graph_search_relations",
    description:
      "Full-text search across ALL relation texts in the graph for `word` — matches the relation prose OR any participant node's label — and returns the matching relation lines with participants. The global counterpart to graph_read_relations (which needs a node_id): use this to find WHERE a concept/design/task is described when you don't know which node holds it (e.g. 'deploy', 'ReBAC', '越境').",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        word: { type: "string", description: "Substring to search for in relation bodies and participant labels (case-insensitive)" },
      },
      required: ["graph_id", "word"],
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
    description: "Update a node's Japanese and/or English label. Pass null to remove a label. Use node_ids (array) to update multiple nodes with the same labels in one call.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "Node ID to update (use node_ids for bulk)" },
        node_ids: { type: "array", items: { type: "string" }, description: "Multiple node IDs to update (alternative to node_id)" },
        ja: { type: "string", description: "New Japanese label (null to remove)" },
        en: { type: "string", description: "New English label (null to remove)" },
      },
      required: ["graph_id"],
    },
  },
  {
    name: "graph_delete_node",
    description: "Delete one or more nodes and all their edges from the graph. Use node_ids (array) to delete multiple nodes in one call.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "Node ID to delete (use node_ids for bulk)" },
        node_ids: { type: "array", items: { type: "string" }, description: "Multiple node IDs to delete (alternative to node_id)" },
      },
      required: ["graph_id"],
    },
  },
  {
    name: "graph_link",
    description:
      "Idempotently create an edge between two nodes. Does nothing if the edge already exists.",
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
      "Idempotently delete an edge between two nodes. Does nothing if the edge does not exist.",
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
    name: "graph_migrate_nodes_to_relations",
    description:
      "[migration] Convert long 'sentence' nodes into relation lines (orphan: body only, no participants). dryRun (default true) returns the candidate list; dryRun:false converts up to `limit` of them (node→relation + node deletion). Rule: ja-label length >= minLen (default 14), node is a leaf (no oriented children), not already a relation participant, EXCLUDING table-name nodes (en starts with m_/p_/j_/h_/v_/t_) and （実体） entity nodes. Review with dryRun, then execute in small batches.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        dryRun: { type: "boolean", description: "true (default): return candidates only. false: actually convert." },
        minLen: { type: "number", description: "Min ja(or en) label length to qualify (default 14)" },
        limit: { type: "number", description: "Max nodes to convert when dryRun is false (default 50, max 1000)" },
      },
      required: ["graph_id"],
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

    if (name === "graph_read_texts_by_word") {
      const word = String(args.word);
      const depth = clampDepth(args.depth);
      const rawLimit = typeof args.limit === "number" ? args.limit : undefined;
      const result = await getNeighborsByWord(env, graphId, word, depth, rawLimit);
      if (result === null) {
        return { content: [{ type: "text", text: `No node found matching: ${word}` }], isError: true };
      }
      const nodes = result.nodes ?? [];
      let text = nodes.map(nodeLine).join("\n") || "(no nodes)";
      if (result.truncated) text += `\n[truncated: ${result.count} nodes returned, more exist — reduce depth]`;
      return { content: [{ type: "text", text }] };
    }

    if (name === "graph_read_nodes_from") {
      const nodeId = String(args.node_id);
      const depth = clampDepth(args.depth);
      const rawLimit = typeof args.limit === "number" ? args.limit : undefined;
      const result = await getNeighbors(env, graphId, nodeId, depth, rawLimit);
      const nodes = result.nodes ?? [];
      let text = nodes.map(nodeLine).join("\n") || "(no nodes)";
      if (result.truncated) text += `\n[truncated: ${result.count} nodes returned, more exist — reduce depth]`;
      return { content: [{ type: "text", text }] };
    }

    if (name === "graph_read_relations") {
      const nodeId = String(args.node_id);
      const word = args.word != null && String(args.word).trim() !== "" ? String(args.word).trim() : undefined;
      const all = await getNodeLines(env, graphId, nodeId);
      const lines = word ? all.filter((l) => lineMatchesWord(l, word)) : all;
      if (lines.length === 0) {
        const suffix = word ? `（word='${word}' に一致する関係）` : "";
        return { content: [{ type: "text", text: `ノード [${nodeId}] に関係テキストはありません${suffix}` }] };
      }
      const header = word
        ? `ノード [${nodeId}] の関係のうち '${word}' を含むもの（${lines.length}件）:`
        : `ノード [${nodeId}] の関係（${lines.length}件）:`;
      const text = [header, ...lines.map(relationLineText)].join("\n\n");
      return { content: [{ type: "text", text }] };
    }

    if (name === "graph_export") {
      const res = await graphFetch(env, graphId, "export");
      if (!res.ok) throw new Error(`graph_export_failed:${res.status}`);
      const data = (await res.json()) as { nodes?: ApiNode[]; relations?: ApiLine[] };
      const nodes = data.nodes ?? [];
      const relations = data.relations ?? [];
      const nodesText = nodes.length ? nodes.map(nodeLine).join("\n") : "(no nodes)";
      const relText = relations.length ? relations.map(relationLineText).join("\n\n") : "(no relations)";
      const text = `# グラフ ${graphId} 全体エクスポート\n\n## ノード（${nodes.length}件）\n${nodesText}\n\n## リレーション（${relations.length}件）\n${relText}`;
      return { content: [{ type: "text", text }] };
    }

    if (name === "graph_search_relations") {
      const word = String(args.word);
      const res = await graphFetch(env, graphId, `search-relations?q=${encodeURIComponent(word)}`);
      if (!res.ok) throw new Error(`graph_search_relations_failed:${res.status}`);
      const data = (await res.json()) as { lines?: ApiLine[] };
      const lines = data.lines ?? [];
      if (lines.length === 0) {
        return { content: [{ type: "text", text: `'${word}' を含むリレーションはありません` }] };
      }
      const text = [`'${word}' を含むリレーション（${lines.length}件）:`, ...lines.map(relationLineText)].join("\n\n");
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
      const ids = Array.isArray(args.node_ids) ? (args.node_ids as string[]) : [String(args.node_id)];
      const body: Record<string, unknown> = {};
      if (args.ja !== undefined) body.ja = args.ja;
      if (args.en !== undefined) body.en = args.en;
      await Promise.all(ids.map(async (id) => {
        const res = await graphFetch(env, graphId, `node/${encodeURIComponent(id)}`, "PATCH", body);
        if (!res.ok) throw new Error(`update_node_failed:${res.status}:${id}`);
      }));
      return { content: [{ type: "text", text: ids.length === 1 ? `Updated [${ids[0]}]` : `Updated ${ids.length} nodes` }] };
    }

    if (name === "graph_delete_node") {
      const ids = Array.isArray(args.node_ids) ? (args.node_ids as string[]) : [String(args.node_id)];
      await Promise.all(ids.map(async (id) => {
        const res = await graphFetch(env, graphId, `node/${encodeURIComponent(id)}`, "DELETE");
        if (!res.ok) throw new Error(`delete_node_failed:${res.status}:${id}`);
      }));
      return { content: [{ type: "text", text: ids.length === 1 ? `Deleted [${ids[0]}]` : `Deleted ${ids.length} nodes` }] };
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

    if (name === "graph_migrate_nodes_to_relations") {
      const payload: Record<string, unknown> = {};
      if (typeof args.dryRun === "boolean") payload.dryRun = args.dryRun;
      if (typeof args.minLen === "number") payload.minLen = args.minLen;
      if (typeof args.limit === "number") payload.limit = args.limit;
      const res = await graphFetch(env, graphId, "migrate-relations", "POST", payload);
      if (!res.ok) throw new Error(`graph_migrate_failed:${res.status}`);
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }

    return { content: [{ type: "text", text: `Unknown graph tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: String(e) }], isError: true };
  }
}
