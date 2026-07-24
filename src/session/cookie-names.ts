// Shared session cookie names used across more than one provider module.
// Kept in one place so the same literal isn't re-declared per file (which had
// drifted into 2-3 copies and one dead copy per name).

// Set during the "link an additional provider to the current identity" flow.
export const IDENTITY_LINK_MODE_COOKIE = "identity_link_mode";

// Carries the pending MCP OAuth authorize params across the login round-trip.
export const MCP_OAUTH_PARAMS_COOKIE = "__Host-mcp_oauth_params";
