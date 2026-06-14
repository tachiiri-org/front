import { authorizeFetch, type AuthorizeEnv } from "../../session";

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

type ApiWord = { id: string; en?: string | null; ja?: string | null; color?: string | null };
type ApiText = { id: string; en?: string | null; ja?: string | null; wordIds: string[] };

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

type ApiDocument = { id: string; en?: string | null; ja?: string | null };

async function getDocuments(env: AuthorizeEnv, graphId: string, textId: string): Promise<ApiDocument[]> {
  const res = await graphFetch(env, graphId, `documents?text_id=${encodeURIComponent(textId)}`);
  if (!res.ok) throw new Error(`get_documents_failed:${res.status}`);
  const data = (await res.json()) as { documents: ApiDocument[] };
  return data.documents;
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
    name: "graph_read_documents_by_text",
    description: "Read all documents (decision logs, context, rationale) linked to a specific text entry in the word graph.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        text_id: { type: "string", description: "Text ID whose documents to retrieve" },
      },
      required: ["graph_id", "text_id"],
    },
  },
  {
    name: "graph_write_text",
    description:
      "Update the words linked to an existing text entry. Cannot create new texts or new words — both must already exist in the graph. Use this to change tag associations (e.g. remove 'fix', add 'delete').",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "Word graph ID (e.g. 'word-graph-1')" },
        text: { type: "string", description: "Text content to update (must already exist)" },
        words: {
          type: "array",
          items: { type: "string" },
          description: "Word names to link to this text. All words must already exist in the graph.",
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

    const wordLabel = (w: ApiWord): string => [w.en, w.ja].filter(Boolean).join(" / ");
    const textLabel = (t: ApiText): string => [t.en, t.ja].filter(Boolean).join(" / ");

    if (name === "graph_read_texts") {
      const texts = await getTexts(env, graphId);
      return { content: [{ type: "text", text: texts.map(textLabel).filter(Boolean).join("\n") || "(no texts)" }] };
    }

    if (name === "graph_read_words") {
      const words = await getWords(env, graphId);
      return { content: [{ type: "text", text: words.map(wordLabel).filter(Boolean).join("\n") || "(no words)" }] };
    }

    if (name === "graph_read_texts_by_word") {
      const wordText = String(args.word);
      const texts = await getTexts(env, graphId, undefined, wordText);
      return { content: [{ type: "text", text: texts.map(textLabel).filter(Boolean).join("\n") || "(no texts linked)" }] };
    }

    if (name === "graph_read_words_by_text") {
      const textContent = String(args.text);
      const [texts, words] = await Promise.all([getTexts(env, graphId), getWords(env, graphId)]);
      const entry = texts.find((t) => t.en === textContent || t.ja === textContent);
      if (!entry) return { content: [{ type: "text", text: `Text not found: ${textContent}` }], isError: true };
      const wordMap = new Map(words.map((w) => [w.id, wordLabel(w)]));
      const linked = entry.wordIds.map((id) => wordMap.get(id)).filter(Boolean) as string[];
      return { content: [{ type: "text", text: linked.join("\n") || "(no words linked)" }] };
    }

    if (name === "graph_write_text") {
      const textContent = String(args.text);
      const wordNames = (args.words as unknown[]).map(String);

      const [existingTexts, existingWords] = await Promise.all([
        getTexts(env, graphId),
        getWords(env, graphId),
      ]);

      const existingText = existingTexts.find((t) => t.en === textContent || t.ja === textContent);
      if (!existingText) {
        return {
          content: [{ type: "text", text: `Text does not exist: "${textContent}". Cannot create new texts via MCP.` }],
          isError: true,
        };
      }

      const existingWordLabels = new Set(existingWords.flatMap((w) => [w.en, w.ja].filter(Boolean) as string[]));
      const unknownWords = wordNames.filter((w) => !existingWordLabels.has(w));
      if (unknownWords.length > 0) {
        return {
          content: [{ type: "text", text: `Cannot create new words via MCP. Unknown words: ${unknownWords.join(", ")}` }],
          isError: true,
        };
      }

      const res = await graphFetch(env, graphId, "text", "POST", { text: textContent, words: wordNames });
      if (!res.ok) throw new Error(`write_text_failed:${res.status}`);
      const result = (await res.json()) as { id: string; en?: string; ja?: string; wordIds: string[] };
      return {
        content: [{ type: "text", text: `Updated: "${[result.en, result.ja].filter(Boolean).join(" / ")}" linked to [${wordNames.join(", ")}]` }],
      };
    }

    if (name === "graph_read_documents_by_text") {
      const textId = String(args.text_id);
      const docs = await getDocuments(env, graphId, textId);
      const docLabel = (d: ApiDocument): string => [d.en, d.ja].filter(Boolean).join(" / ");
      return { content: [{ type: "text", text: docs.map(docLabel).filter(Boolean).join("\n\n---\n\n") || "(no documents)" }] };
    }

    return { content: [{ type: "text", text: `Unknown graph tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: "text", text: String(e) }], isError: true };
  }
}
