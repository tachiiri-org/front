import { authorizeFetch, type AuthorizeEnv } from "../../auth";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

// --- API helpers ---

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
    tenantContext: env.actor?.tenant ? { tenantId: env.actor.tenant } : undefined,
  });
}

type ApiWord = { id: string; text: string; color?: string | null };
type ApiText = { id: string; text: string; wordIds: string[] };

async function getWords(env: AuthorizeEnv, graphId: string): Promise<ApiWord[]> {
  const res = await graphFetch(env, graphId, "words");
  if (!res.ok) throw new Error(`get_words_failed:${res.status}`);
  const data = (await res.json()) as { words: ApiWord[] };
  return data.words;
}

async function getTexts(env: AuthorizeEnv, graphId: string, wordId?: string, wordText?: string): Promise<ApiText[]> {
  let resource = "texts";
  if (wordText) {
    resource = `texts?word=${encodeURIComponent(wordText)}`;
  } else if (wordId) {
    resource = `texts?word_id=${encodeURIComponent(wordId)}`;
  }
  const res = await graphFetch(env, graphId, resource);
  if (!res.ok) throw new Error(`get_texts_failed:${res.status}`);
  const data = (await res.json()) as { texts: ApiText[] };
  return data.texts;
}

// --- Tool definitions ---

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
    description:
      "Read all texts linked to a specific word. Use word='issue' to read issues, word='goal' to read goals, word='draft' to read unaccepted texts.",
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
    name: "graph_write_text",
    description:
      "Create or update a text entry and set the words linked to it. Words that do not exist are created automatically. Include 'issue' in words for contradictions/undefined items, 'goal' for divergence between ideal and current state. All AI-written texts are automatically linked to 'draft'.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        text: { type: "string", description: "Text content to create or update" },
        words: {
          type: "array",
          items: { type: "string" },
          description:
            "Word names to link to this text. 'draft' is added automatically. Include 'issue' for contradictions, 'goal' for ideal/current divergence.",
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

    if (name === "graph_read_texts") {
      const texts = await getTexts(env, graphId);
      return { content: [{ type: "text", text: texts.map((t) => t.text).filter(Boolean).join("\n") || "(no texts)" }] };
    }

    if (name === "graph_read_words") {
      const words = await getWords(env, graphId);
      return { content: [{ type: "text", text: words.map((w) => w.text).filter(Boolean).join("\n") || "(no words)" }] };
    }

    if (name === "graph_read_texts_by_word") {
      const wordText = String(args.word);
      const texts = await getTexts(env, graphId, undefined, wordText);
      return { content: [{ type: "text", text: texts.map((t) => t.text).filter(Boolean).join("\n") || "(no texts linked)" }] };
    }

    if (name === "graph_read_words_by_text") {
      const textContent = String(args.text);
      const [texts, words] = await Promise.all([getTexts(env, graphId), getWords(env, graphId)]);
      const entry = texts.find((t) => t.text === textContent);
      if (!entry) return { content: [{ type: "text", text: `Text not found: ${textContent}` }], isError: true };
      const wordMap = new Map(words.map((w) => [w.id, w.text]));
      const linked = entry.wordIds.map((id) => wordMap.get(id)).filter(Boolean) as string[];
      return { content: [{ type: "text", text: linked.join("\n") || "(no words linked)" }] };
    }

    if (name === "graph_write_text") {
      const textContent = String(args.text);
      const wordNames = (args.words as unknown[]).map(String);

      if (!wordNames.includes("draft")) wordNames.push("draft");

      const res = await graphFetch(env, graphId, "text", "POST", { text: textContent, words: wordNames });
      if (!res.ok) throw new Error(`write_text_failed:${res.status}`);
      const result = (await res.json()) as { id: string; text: string; wordIds: string[] };
      return {
        content: [{ type: "text", text: `Saved: "${result.text}" linked to [${wordNames.join(", ")}]` }],
      };
    }

    return { content: [{ type: "text", text: `Unknown graph tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: String(e) }], isError: true };
  }
}
