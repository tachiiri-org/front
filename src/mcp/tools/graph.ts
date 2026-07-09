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

// Depth for graph_read_children: how many levels of children to expand. Default 3, max 6.
function clampChildDepth(raw: unknown): number {
  const n = typeof raw === "number" ? Math.floor(raw) : 3;
  return Math.min(Math.max(Number.isFinite(n) ? n : 3, 1), 6);
}

const nodeLabel = (n: ApiNode): string => [n.en, n.ja].filter(Boolean).join(" / ");
const nodeLine = (n: ApiNode): string => `[${n.id}] ${nodeLabel(n)}`;

// Direct oriented children of a node (same set the editor's node panel shows), ordered by the
// h_node_line chain. Textless structural edges only — relation lines are excluded.
async function getChildren(env: AuthorizeEnv, graphId: string, nodeId: string, limit?: number): Promise<ApiNode[]> {
  const qs = limit != null ? `?limit=${encodeURIComponent(String(limit))}` : "";
  const res = await graphFetch(env, graphId, `node/${encodeURIComponent(nodeId)}/children${qs}`);
  if (!res.ok) throw new Error(`get_children_failed:${res.status}`);
  const data = (await res.json()) as { nodes?: ApiNode[] };
  return data.nodes ?? [];
}

// Recursively read a node's children into an indented tree. Cycle handling is PATH-based: a node is
// only stopped when it reappears among its OWN ancestors on the current path (a true cycle) — the
// same node legitimately appearing under different parents (multi-membership) is kept, because
// identity here is the path from the start node, not the bare node id. Depth-capped and node-capped.
async function readChildrenTree(
  env: AuthorizeEnv,
  graphId: string,
  startId: string,
  maxDepth: number,
  limit: number,
): Promise<{ lines: string[]; count: number; truncated: boolean }> {
  const out: string[] = [];
  const state = { count: 0, truncated: false };
  const walk = async (id: string, depth: number, ancestors: Set<string>): Promise<void> => {
    if (state.truncated || depth >= maxDepth) return;
    let kids: ApiNode[];
    try {
      kids = await getChildren(env, graphId, id);
    } catch {
      return;
    }
    for (const k of kids) {
      if (state.count >= limit) {
        state.truncated = true;
        return;
      }
      const cyc = ancestors.has(k.id);
      out.push(`${"  ".repeat(depth)}- ${nodeLine(k)}${cyc ? " ⟳(循環: 祖先に既出のため展開省略)" : ""}`);
      state.count += 1;
      if (!cyc) {
        const next = new Set(ancestors);
        next.add(k.id);
        await walk(k.id, depth + 1, next);
      }
    }
  };
  await walk(startId, 0, new Set([startId]));
  return { lines: out, count: state.count, truncated: state.truncated };
}

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
    name: "graph_read_children",
    description:
      "Read the DIRECTED CHILDREN (子ノード / group) of a node, recursively, as an indented tree. This is the hierarchy/grouping structure — e.g. reading 「曜日」returns 月・火・水… — and is the RIGHT tool for understanding how concepts are grouped under a node (unlike graph_read_nodes_from, which walks undirected neighbors and ignores direction). Any node can be a child of multiple parents (multi-membership); such a node legitimately appears under each of its parents. Cycles are handled by path (a node is only stopped when it reappears among its own ancestors on the current path), so `曜日/月` and `月/曜日` are distinct paths, not a loop.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "Node whose children (group) to read" },
        depth: { type: "number", description: "Levels of children to expand (default 3, max 6)" },
        limit: { type: "number", description: "Max nodes to emit (default 200, max 1000). Truncates when exceeded." },
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
    name: "graph_orient",
    description:
      "Set (or clear) the PARENT endpoint of the edge between two nodes — the direction used to render a hierarchy from the otherwise-undirected links. parent_node_id becomes the parent (the other node is its child); with clear=true the edge returns to undirected. A node never shows as a child under an edge whose parent is the other endpoint, so this is how you stop a category/hub node from appearing under its members.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "One endpoint of the edge" },
        parent_node_id: { type: "string", description: "The endpoint to mark as PARENT (must be the other endpoint of this edge)" },
        clear: { type: "boolean", description: "If true, remove the orientation (edge becomes undirected). parent_node_id is still required, to locate the edge." },
      },
      required: ["graph_id", "node_id", "parent_node_id"],
    },
  },
  {
    name: "graph_orient_children",
    description:
      "Bulk-orient every edge of a node so the node is the PARENT (each neighbour becomes its child), EXCEPT neighbours in `except`, whose edge is oriented the other way (that neighbour is the node's parent). Mark a category/hub in one call: e.g. graph_orient_children on '単語' with except=['<カテゴリ id>'] makes 単語 the parent of all its member words while keeping カテゴリ as 単語's parent — so 単語 shows only under カテゴリ, not under every member.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        node_id: { type: "string", description: "The category/hub node to make the parent of its edges" },
        except: { type: "array", items: { type: "string" }, description: "Neighbour node ids that are instead this node's PARENT (their edge points toward them)" },
      },
      required: ["graph_id", "node_id"],
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

    if (name === "graph_read_children") {
      const nodeId = String(args.node_id);
      const maxDepth = clampChildDepth(args.depth);
      const rawLimit = typeof args.limit === "number" ? Math.floor(args.limit) : 200;
      const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 200, 1), 1000);
      const { lines, count, truncated } = await readChildrenTree(env, graphId, nodeId, maxDepth, limit);
      if (count === 0) {
        return { content: [{ type: "text", text: `ノード [${nodeId}] に子ノードはありません` }] };
      }
      let text = `ノード [${nodeId}] の子（${count}件, 深さ${maxDepth}まで）:\n${lines.join("\n")}`;
      if (truncated) text += `\n[truncated: ${count} nodes emitted, more exist — reduce depth or raise limit]`;
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

    if (name === "graph_orient") {
      const nodeId = String(args.node_id);
      const parentId = String(args.parent_node_id);
      const clear = args.clear === true;
      const res = await graphFetch(env, graphId, "orient", "POST", { nodeId, parentId, clear });
      if (!res.ok) throw new Error(`graph_orient_failed:${res.status}`);
      const data = (await res.json()) as { oriented: boolean };
      return { content: [{ type: "text", text: data.oriented ? `Oriented: parent [${parentId}] → child [${nodeId}]` : `Cleared orientation between [${nodeId}] and [${parentId}]` }] };
    }

    if (name === "graph_orient_children") {
      const nodeId = String(args.node_id);
      const except = Array.isArray(args.except) ? (args.except as string[]) : [];
      const res = await graphFetch(env, graphId, `node/${encodeURIComponent(nodeId)}/orient-children`, "POST", { except });
      if (!res.ok) throw new Error(`graph_orient_children_failed:${res.status}`);
      const data = (await res.json()) as { oriented: number };
      return { content: [{ type: "text", text: `Oriented ${data.oriented} edges of [${nodeId}] as parent${except.length ? ` (except parents: ${except.join(", ")})` : ""}` }] };
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
