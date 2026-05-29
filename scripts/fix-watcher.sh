#!/bin/bash
set -euo pipefail

MCP_URL="http://localhost:8787/mcp"
GRAPH_ID="word-graph-1"
LOCK_FILE="/tmp/claude-fix.lock"
HEARTBEAT_INTERVAL=120   # seconds between heartbeat updates
STALE_THRESHOLD=1800     # 30 min: treat lock as crashed

# ── MCP helpers ──────────────────────────────────────────────────────────────

mcp_call() {
  local tool=$1
  local args_json=$2
  curl -sf -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args_json}}"
}

graph_read_fix_texts() {
  mcp_call "graph_read_texts_by_word" \
    "{\"graph_id\":\"$GRAPH_ID\",\"word\":\"fix\"}" \
    | jq -r '.result.content[0].text // empty'
}

graph_set_heartbeat() {
  local text=$1
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  mcp_call "graph_write_text" \
    "$(jq -nc --arg g "$GRAPH_ID" --arg t "$text" --arg h "$ts" \
       '{graph_id:$g,text:$t,words:["fix"],heartbeat:$h}')" \
    > /dev/null
}

graph_mark_done() {
  local text=$1
  mcp_call "graph_write_text" \
    "$(jq -nc --arg g "$GRAPH_ID" --arg t "$text" \
       '{graph_id:$g,text:$t,words:["delete"]}')" \
    > /dev/null
}

# ── Lock / heartbeat logic ────────────────────────────────────────────────────

# Returns 0 if locked (active runner), 1 if not locked (or stale → clears lock)
check_lock() {
  [[ ! -f "$LOCK_FILE" ]] && return 1

  local raw
  raw=$(graph_read_fix_texts 2>/dev/null || true)

  # Extract the most recent heartbeat timestamp across all fix texts
  local newest_hb
  newest_hb=$(echo "$raw" \
    | grep -oP '\[heartbeat: \K[^\]]+' \
    | sort -r | head -1 || true)

  if [[ -z "$newest_hb" ]]; then
    log "lock file exists but no heartbeat found — removing stale lock"
    rm -f "$LOCK_FILE"
    return 1
  fi

  local hb_epoch now_epoch age
  hb_epoch=$(date -d "$newest_hb" +%s 2>/dev/null || echo 0)
  now_epoch=$(date +%s)
  age=$(( now_epoch - hb_epoch ))

  if (( age > STALE_THRESHOLD )); then
    log "heartbeat is ${age}s old (>${STALE_THRESHOLD}s) — removing stale lock"
    rm -f "$LOCK_FILE"
    return 1
  fi

  log "locked — heartbeat is ${age}s old"
  return 0
}

# ── Utilities ─────────────────────────────────────────────────────────────────

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# Strip [heartbeat: ...] suffix to get the plain text content
strip_heartbeat() { sed 's/ \[heartbeat: [^]]*\]//g'; }

# Return the oldest fix text (last line, stripped)
get_oldest_fix_text() {
  graph_read_fix_texts 2>/dev/null \
    | strip_heartbeat \
    | grep -v '^\s*$' \
    | tail -1
}

# ── Main loop ─────────────────────────────────────────────────────────────────

log "fix-watcher started (graph: $GRAPH_ID)"

while true; do
  log "polling fix texts..."

  if check_lock; then
    sleep 30
    continue
  fi

  FIX_TEXT=$(get_oldest_fix_text || true)

  if [[ -z "$FIX_TEXT" ]]; then
    log "no pending fixes"
    sleep 60
    continue
  fi

  log "→ processing: $FIX_TEXT"
  touch "$LOCK_FILE"

  # Initial heartbeat
  graph_set_heartbeat "$FIX_TEXT"

  # Background heartbeat updater
  (
    while [[ -f "$LOCK_FILE" ]]; do
      sleep "$HEARTBEAT_INTERVAL"
      [[ -f "$LOCK_FILE" ]] && graph_set_heartbeat "$FIX_TEXT" 2>/dev/null || true
    done
  ) &
  HEARTBEAT_PID=$!

  # Build prompt for Claude
  PROMPT=$(cat <<EOF
Fix the following issue from the word graph:

"$FIX_TEXT"

Steps:
1. Identify the relevant source files and implement the fix.
2. Run type checks (npx tsc --noEmit).
3. git commit the changes.
4. Call graph_write_text to mark the fix as done:
   - graph_id: $GRAPH_ID
   - text: (exact text above)
   - words: ["delete"]
   (this removes the "fix" label and queues it for human review)

Working directory: /home/tachiiri/project/front
EOF
)

  echo "────────────────────────────────────────"
  # Run Claude Code — output streams to this terminal
  if claude --print --dangerously-skip-permissions "$PROMPT"; then
    log "✓ done: $FIX_TEXT"
  else
    log "✗ failed: $FIX_TEXT (exit $?)"
  fi
  echo "────────────────────────────────────────"

  # Cleanup
  kill "$HEARTBEAT_PID" 2>/dev/null || true
  rm -f "$LOCK_FILE"

  sleep 5
done
