import { authorizeFetch, type AuthorizeEnv } from "../../auth";

const treeKey = (treeId: string) => `trees/${treeId}.json`;
const docKey = (nodeId: string) => `docs/${nodeId}.json`;

type KnowledgeNode = {
  id: string;
  text: string;
  children: KnowledgeNode[];
  status: "accepted" | "proposed";
  type?: "knowledge" | "issue";
  proposedAt?: string;
  proposedBy?: string;
};

type KnowledgeTree = {
  nodes: KnowledgeNode[];
};

type Doc = { content: string };

const fromBase64 = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
};

const getBucketId = (env: AuthorizeEnv): string =>
  ((env as Record<string, unknown>).LAYOUTS_BUCKET_ID as string | undefined) ?? "bucket-dev";

async function readTree(env: AuthorizeEnv, treeId: string): Promise<KnowledgeTree> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/cloudflare-r2-adapter/s3/r2_file_get",
    method: "POST",
    body: JSON.stringify({ bucket_id: getBucketId(env), key: treeKey(treeId) }),
  });
  if (response.status === 404) return { nodes: [] };
  if (!response.ok) throw new Error(`knowledge_read_failed:${response.status}`);
  const payload = (await response.json()) as { content_base64: string };
  return JSON.parse(fromBase64(payload.content_base64)) as KnowledgeTree;
}

async function writeTree(env: AuthorizeEnv, treeId: string, tree: KnowledgeTree): Promise<void> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/cloudflare-r2-adapter/s3/r2_file_save",
    method: "POST",
    body: JSON.stringify({
      bucket_id: getBucketId(env),
      key: treeKey(treeId),
      content: JSON.stringify(tree, null, 2),
    }),
  });
  if (!response.ok) throw new Error(`knowledge_write_failed:${response.status}`);
}

async function readDoc(env: AuthorizeEnv, nodeId: string): Promise<Doc> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/cloudflare-r2-adapter/s3/r2_file_get",
    method: "POST",
    body: JSON.stringify({ bucket_id: getBucketId(env), key: docKey(nodeId) }),
  });
  if (response.status === 404) return { content: "" };
  if (!response.ok) throw new Error(`doc_read_failed:${response.status}`);
  const payload = (await response.json()) as { content_base64: string };
  return JSON.parse(fromBase64(payload.content_base64)) as Doc;
}

async function writeDoc(env: AuthorizeEnv, nodeId: string, doc: Doc): Promise<void> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/cloudflare-r2-adapter/s3/r2_file_save",
    method: "POST",
    body: JSON.stringify({
      bucket_id: getBucketId(env),
      key: docKey(nodeId),
      content: JSON.stringify(doc),
    }),
  });
  if (!response.ok) throw new Error(`doc_write_failed:${response.status}`);
}

function toOutline(nodes: KnowledgeNode[], depth = 0): string {
  const indent = "  ".repeat(depth);
  return nodes
    .flatMap((node) => {
      if (!node.text.trim()) return [];
      const isProposed = node.status === "proposed";
      const isIssue = node.type === "issue";
      const text = node.text.replace(/^\?\s*/, "");
      const prefix = isProposed ? (isIssue ? "? " : "~ ") : "";
      const line = `${indent}${prefix}${text}`;
      const childLines = node.children?.length ? toOutline(node.children, depth + 1) : "";
      return childLines ? [line, childLines] : [line];
    })
    .join("\n");
}

function findNode(nodes: KnowledgeNode[], id: string): KnowledgeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children ?? [], id);
    if (found) return found;
  }
  return null;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export const KNOWLEDGE_TOOLS = [
  {
    name: "knowledge_read",
    description: "Read a knowledge tree from the list editor. Returns the full tree including accepted and proposed nodes.",
    inputSchema: {
      type: "object",
      properties: {
        tree_id: { type: "string", description: "Tree ID (the UUID in the list editor's source URL /api/trees/{tree_id})" },
      },
      required: ["tree_id"],
    },
  },
  {
    name: "knowledge_propose",
    description:
      "Propose a new or updated node in the list editor tree. Creates a 'proposed' node for human review. Use node_id to update an existing node, omit to create a new one. Use parent_id to nest under a specific node.",
    inputSchema: {
      type: "object",
      properties: {
        tree_id: { type: "string", description: "Tree ID" },
        text: { type: "string", description: "Node text content" },
        type: { type: "string", enum: ["knowledge", "issue"], description: "Node type. Use 'issue' for discussion points or detected gaps. Defaults to 'knowledge'." },
        parent_id: { type: "string", description: "Parent node ID. Omit to add at root level." },
        node_id: { type: "string", description: "Existing node ID to update. Omit to create a new node." },
      },
      required: ["tree_id", "text"],
    },
  },
  {
    name: "doc_read",
    description: "Read the doc content for a specific node.",
    inputSchema: {
      type: "object",
      properties: {
        node_id: { type: "string", description: "Node ID" },
      },
      required: ["node_id"],
    },
  },
  {
    name: "doc_write",
    description: "Write doc content for a node. Sets the node's status to 'proposed' to indicate AI-generated content awaiting review.",
    inputSchema: {
      type: "object",
      properties: {
        tree_id: { type: "string", description: "Tree ID" },
        node_id: { type: "string", description: "Node ID" },
        content: { type: "string", description: "Doc content to write" },
      },
      required: ["tree_id", "node_id", "content"],
    },
  },
];

export async function callKnowledgeTool(
  name: string,
  args: Record<string, unknown>,
  env: AuthorizeEnv,
): Promise<ToolResult> {
  try {
    if (name === "knowledge_read") {
      const treeId = String(args.tree_id);
      const tree = await readTree(env, treeId);
      const legend = "# ~ proposed knowledge  ? proposed issue\n";
      return { content: [{ type: "text", text: legend + toOutline(tree.nodes) }] };
    }

    if (name === "knowledge_propose") {
      const treeId = String(args.tree_id);
      const text = String(args.text);
      const tree = await readTree(env, treeId);

      const nodeType = args.type === "issue" ? "issue" : "knowledge";

      if (args.node_id) {
        const node = findNode(tree.nodes, String(args.node_id));
        if (!node) {
          return { content: [{ type: "text", text: `Node not found: ${args.node_id}` }], isError: true };
        }
        node.text = text;
        node.status = "proposed";
        node.type = nodeType;
        node.proposedAt = new Date().toISOString();
        node.proposedBy = "claude";
        await writeTree(env, treeId, tree);
        return { content: [{ type: "text", text: `Proposed update to node "${text}" (id: ${node.id})` }] };
      }

      const newNode: KnowledgeNode = {
        id: crypto.randomUUID(),
        text,
        children: [],
        status: "proposed",
        type: nodeType,
        proposedAt: new Date().toISOString(),
        proposedBy: "claude",
      };

      if (args.parent_id) {
        const parent = findNode(tree.nodes, String(args.parent_id));
        if (!parent) {
          return { content: [{ type: "text", text: `Parent not found: ${args.parent_id}` }], isError: true };
        }
        parent.children.push(newNode);
      } else {
        tree.nodes.push(newNode);
      }

      await writeTree(env, treeId, tree);
      return { content: [{ type: "text", text: `Proposed node "${text}" (id: ${newNode.id})` }] };
    }

    if (name === "knowledge_accept") {
      const treeId = String(args.tree_id);
      const nodeId = String(args.node_id);
      const tree = await readTree(env, treeId);
      const node = findNode(tree.nodes, nodeId);
      if (!node) {
        return { content: [{ type: "text", text: `Node not found: ${nodeId}` }], isError: true };
      }
      node.status = "accepted";
      delete node.proposedAt;
      delete node.proposedBy;
      await writeTree(env, treeId, tree);
      return { content: [{ type: "text", text: `Accepted node "${node.text}" (id: ${nodeId})` }] };
    }

    if (name === "doc_read") {
      const nodeId = String(args.node_id);
      const doc = await readDoc(env, nodeId);
      return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
    }

    if (name === "doc_write") {
      const treeId = String(args.tree_id);
      const nodeId = String(args.node_id);
      const content = String(args.content);
      const tree = await readTree(env, treeId);
      const node = findNode(tree.nodes, nodeId);
      if (!node) {
        return { content: [{ type: "text", text: `Node not found: ${nodeId}` }], isError: true };
      }
      node.status = "proposed";
      node.proposedAt = new Date().toISOString();
      node.proposedBy = "claude";
      await writeDoc(env, nodeId, { content });
      await writeTree(env, treeId, tree);
      return { content: [{ type: "text", text: `Wrote doc for node "${node.text}" (id: ${nodeId})` }] };
    }

    return { content: [{ type: "text", text: `Unknown knowledge tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: String(e) }], isError: true };
  }
}
