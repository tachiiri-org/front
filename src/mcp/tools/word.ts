import { authorizeFetch, type AuthorizeEnv } from "../../auth";

const wordGraphKey = (graphId: string) => `word-graphs/${graphId}.json`;

type GraphWord = {
  id: string;
  text: string;
  status?: "accepted" | "proposed";
  type?: "knowledge" | "issue";
};

type GraphText = {
  id: string;
  text: string;
  wordIds: string[];
};

type WordGraph = {
  words: GraphWord[];
  texts: GraphText[];
};

const fromBase64 = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
};

const getBucketId = (env: AuthorizeEnv): string =>
  ((env as Record<string, unknown>).LAYOUTS_BUCKET_ID as string | undefined) ?? "bucket-dev";

async function readWordGraph(env: AuthorizeEnv, graphId: string): Promise<WordGraph> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/cloudflare-r2-adapter/s3/r2_file_get",
    method: "POST",
    body: JSON.stringify({ bucket_id: getBucketId(env), key: wordGraphKey(graphId) }),
  });
  if (response.status === 404) return { words: [], texts: [] };
  if (!response.ok) throw new Error(`word_read_failed:${response.status}`);
  const payload = (await response.json()) as { content_base64: string };
  return JSON.parse(fromBase64(payload.content_base64)) as WordGraph;
}

function toOutline(graph: WordGraph): string {
  const textsByWord = new Map<string, GraphText[]>();
  for (const t of graph.texts) {
    for (const wid of t.wordIds) {
      const arr = textsByWord.get(wid) ?? [];
      arr.push(t);
      textsByWord.set(wid, arr);
    }
  }

  const lines: string[] = [];
  for (const word of graph.words) {
    const statusMark = word.status === "proposed" ? " ~" : "";
    lines.push(`${word.text} [${word.id}]${statusMark}`);
    const texts = textsByWord.get(word.id) ?? [];
    for (const t of texts) {
      if (t.text.trim()) lines.push(`  ${t.text}`);
    }
  }
  return lines.join("\n");
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export const WORD_TOOLS = [
  {
    name: "word_read",
    description:
      "Read a word graph from the word editor. Returns all words and their associated texts. Use graph_id 'word-graph-1' for the default graph.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: {
          type: "string",
          description: "Word graph ID (e.g. 'word-graph-1')",
        },
      },
      required: ["graph_id"],
    },
  },
];

export async function callWordTool(
  name: string,
  args: Record<string, unknown>,
  env: AuthorizeEnv,
): Promise<ToolResult> {
  try {
    if (name === "word_read") {
      const graphId = String(args.graph_id);
      const graph = await readWordGraph(env, graphId);
      const legend = "# ~ proposed word\n";
      const outline = legend + toOutline(graph);
      return { content: [{ type: "text", text: outline }] };
    }

    return { content: [{ type: "text", text: `Unknown word tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: String(e) }], isError: true };
  }
}
