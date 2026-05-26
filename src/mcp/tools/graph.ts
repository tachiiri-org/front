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
  status?: "accepted" | "proposed";
  type?: "knowledge" | "issue";
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
  if (!response.ok) throw new Error(`graph_read_failed:${response.status}`);
  const payload = (await response.json()) as { content_base64: string };
  return JSON.parse(fromBase64(payload.content_base64)) as WordGraph;
}

async function writeWordGraph(env: AuthorizeEnv, graphId: string, graph: WordGraph): Promise<void> {
  const response = await authorizeFetch(env, {
    path: "/api/v1/cloudflare-r2-adapter/s3/r2_file_save",
    method: "POST",
    body: JSON.stringify({
      bucket_id: getBucketId(env),
      key: wordGraphKey(graphId),
      content: JSON.stringify(graph, null, 2),
    }),
  });
  if (!response.ok) throw new Error(`graph_write_failed:${response.status}`);
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export const GRAPH_TOOLS = [
  {
    name: "graph_read_texts",
    description: "Read all texts in the word graph.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
      },
      required: ["graph_id"],
    },
  },
  {
    name: "graph_read_words",
    description: "Read all words in the word graph.",
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
    description: "Read all texts linked to a specific word.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        word: { type: "string", description: "Word text to look up" },
      },
      required: ["graph_id", "word"],
    },
  },
  {
    name: "graph_read_words_by_text",
    description: "Read all words linked to a specific text.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        text: { type: "string", description: "Text content to look up" },
      },
      required: ["graph_id", "text"],
    },
  },
  {
    name: "graph_read_issues",
    description: "Read all texts marked as issue type in the word graph.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
      },
      required: ["graph_id"],
    },
  },
  {
    name: "graph_write_text",
    description: "Create or update a text entry and set the words linked to it. Words that do not exist are created automatically.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        text: { type: "string", description: "Text content to create or update" },
        words: {
          type: "array",
          items: { type: "string" },
          description: "Word names to link to this text. Replaces existing links.",
        },
      },
      required: ["graph_id", "text", "words"],
    },
  },
];

export async function callGraphTool(
  name: string,
  args: Record<string, unknown>,
  env: AuthorizeEnv,
): Promise<ToolResult> {
  try {
    const graphId = String(args.graph_id);
    const graph = await readWordGraph(env, graphId);

    if (name === "graph_read_texts") {
      const texts = graph.texts.map((t) => t.text).filter(Boolean);
      return { content: [{ type: "text", text: texts.join("\n") || "(no texts)" }] };
    }

    if (name === "graph_read_words") {
      const words = graph.words.map((w) => w.text).filter(Boolean);
      return { content: [{ type: "text", text: words.join("\n") || "(no words)" }] };
    }

    if (name === "graph_read_texts_by_word") {
      const wordText = String(args.word);
      const word = graph.words.find((w) => w.text === wordText);
      if (!word) return { content: [{ type: "text", text: `Word not found: ${wordText}` }], isError: true };
      const texts = graph.texts.filter((t) => t.wordIds.includes(word.id)).map((t) => t.text).filter(Boolean);
      return { content: [{ type: "text", text: texts.join("\n") || "(no texts linked)" }] };
    }

    if (name === "graph_read_words_by_text") {
      const textContent = String(args.text);
      const entry = graph.texts.find((t) => t.text === textContent);
      if (!entry) return { content: [{ type: "text", text: `Text not found: ${textContent}` }], isError: true };
      const wordMap = new Map(graph.words.map((w) => [w.id, w.text]));
      const words = entry.wordIds.map((id) => wordMap.get(id)).filter(Boolean) as string[];
      return { content: [{ type: "text", text: words.join("\n") || "(no words linked)" }] };
    }

    if (name === "graph_read_issues") {
      const issues = graph.texts.filter((t) => t.type === "issue").map((t) => t.text).filter(Boolean);
      return { content: [{ type: "text", text: issues.join("\n") || "(no issues)" }] };
    }

    if (name === "graph_write_text") {
      const textContent = String(args.text);
      const wordNames = (args.words as unknown[]).map(String);

      const wordIds: string[] = [];
      for (const wname of wordNames) {
        let word = graph.words.find((w) => w.text === wname);
        if (!word) {
          word = { id: crypto.randomUUID(), text: wname };
          graph.words.push(word);
        }
        wordIds.push(word.id);
      }

      const entry = graph.texts.find((t) => t.text === textContent);
      if (entry) {
        entry.wordIds = wordIds;
        entry.status = "proposed";
      } else {
        graph.texts.push({ id: crypto.randomUUID(), text: textContent, wordIds, status: "proposed" });
      }

      await writeWordGraph(env, graphId, graph);
      return { content: [{ type: "text", text: `Saved: "${textContent}" linked to [${wordNames.join(", ")}]` }] };
    }

    return { content: [{ type: "text", text: `Unknown graph tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: String(e) }], isError: true };
  }
}
