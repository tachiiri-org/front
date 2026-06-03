Before starting any task:
1. Get the full word list using `mcp__front-stage__graph_read_words` with graph_id `word-graph-1`.
2. Identify words relevant to the current task and read their texts using `mcp__front-stage__graph_read_texts_by_word`.

Before performing any significant action (e.g. deploy, migrate, run scripts):
- Check if a word in the graph corresponds to that action type.
- If so, read its texts before proceeding — do not rely on assumed knowledge.

If any MCP call fails due to authentication expiry, stop and ask the user to re-authenticate, then retry before continuing.
