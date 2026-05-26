import { authorizeFetch, type AuthorizeEnv } from "../../auth";

const wordGraphKey = (graphId: string) => `word-graphs/${graphId}.json`;

type TextStatus = "accepted" | "proposed";
type TextType = "knowledge" | "issue" | "task";

type GraphWord = {
  id: string;
  text: string;
  status?: TextStatus;
  type?: TextType;
};

type GraphText = {
  id: string;
  text: string;
  wordIds: string[];
  status?: TextStatus;
  type?: TextType;
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
    description: "Read texts in the word graph. Supports filtering by status/type and grouping.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        status: {
          oneOf: [
            { type: "string", enum: ["accepted", "proposed"] },
            { type: "array", items: { type: "string", enum: ["accepted", "proposed"] } },
          ],
          description: "Filter by status. Omit to return all.",
        },
        type: {
          oneOf: [
            { type: "string", enum: ["knowledge", "issue", "task"] },
            { type: "array", items: { type: "string", enum: ["knowledge", "issue", "task"] } },
          ],
          description: "Filter by type. Omit to return all.",
        },
        group_by: {
          type: "string",
          enum: ["status", "type"],
          description: "Group output by status or type.",
        },
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
    name: "graph_read_tasks",
    description: "Read all texts marked as task type in the word graph.",
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
    description: "Create or update a text entry and set the words linked to it. Words that do not exist are created automatically. Use type='issue' for contradictions/undefined items, type='task' for divergence between ideal and current state.",
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
        type: {
          type: "string",
          enum: ["issue", "task"],
          description: "Optional type: 'issue' for contradictions or undefined items, 'task' for items where current state diverges from ideal.",
        },
      },
      required: ["graph_id", "text", "words"],
    },
  },
  {
    name: "graph_update_text",
    description: "Update the status or type of an existing text. Use to mark tasks as done, accept proposed texts, or reclassify entries.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        text: { type: "string", description: "Exact text content to find and update" },
        status: {
          type: "string",
          enum: ["accepted", "proposed"],
          description: "New status to set",
        },
        type: {
          type: "string",
          enum: ["knowledge", "issue", "task"],
          description: "New type to set",
        },
      },
      required: ["graph_id", "text"],
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
      const statusFilter = args.status
        ? (Array.isArray(args.status) ? args.status : [args.status]) as TextStatus[]
        : null;
      const typeFilter = args.type
        ? (Array.isArray(args.type) ? args.type : [args.type]) as TextType[]
        : null;
      const groupBy = args.group_by as "status" | "type" | undefined;

      const filtered = graph.texts.filter((t) => {
        if (statusFilter && !statusFilter.includes(t.status as TextStatus)) return false;
        if (typeFilter && !typeFilter.includes(t.type as TextType)) return false;
        return true;
      });

      if (!groupBy) {
        const texts = filtered.map((t) => t.text).filter(Boolean);
        return { content: [{ type: "text", text: texts.join("\n") || "(no texts)" }] };
      }

      const groups = new Map<string, string[]>();
      for (const t of filtered) {
        const key = (groupBy === "status" ? t.status : t.type) ?? "(none)";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(t.text);
      }

      const lines: string[] = [];
      for (const [key, texts] of groups) {
        lines.push(`=== ${key} ===`);
        lines.push(...texts.filter(Boolean));
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n").trim() || "(no texts)" }] };
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

    if (name === "graph_read_tasks") {
      const tasks = graph.texts.filter((t) => t.type === "task").map((t) => t.text).filter(Boolean);
      return { content: [{ type: "text", text: tasks.join("\n") || "(no tasks)" }] };
    }

    if (name === "graph_write_text") {
      const textContent = String(args.text);
      const wordNames = (args.words as unknown[]).map(String);
      const textType = args.type as "issue" | "task" | undefined;

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
        if (textType) entry.type = textType;
      } else {
        const newEntry: GraphText = { id: crypto.randomUUID(), text: textContent, wordIds, status: "proposed" };
        if (textType) newEntry.type = textType;
        graph.texts.unshift(newEntry);
      }

      await writeWordGraph(env, graphId, graph);
      const typeLabel = textType ? ` [${textType}]` : "";
      return { content: [{ type: "text", text: `Saved${typeLabel}: "${textContent}" linked to [${wordNames.join(", ")}]` }] };
    }

    if (name === "graph_update_text") {
      const textContent = String(args.text);
      const entry = graph.texts.find((t) => t.text === textContent);
      if (!entry) return { content: [{ type: "text", text: `Text not found: ${textContent}` }], isError: true };

      const updates: string[] = [];
      if (args.status) { entry.status = args.status as TextStatus; updates.push(`status=${args.status}`); }
      if (args.type) { entry.type = args.type as TextType; updates.push(`type=${args.type}`); }

      if (updates.length === 0) return { content: [{ type: "text", text: "No updates specified" }], isError: true };

      await writeWordGraph(env, graphId, graph);
      return { content: [{ type: "text", text: `Updated "${textContent}": ${updates.join(", ")}` }] };
    }

    return { content: [{ type: "text", text: `Unknown graph tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: String(e) }], isError: true };
  }
}
