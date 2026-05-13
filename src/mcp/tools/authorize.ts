import { authorizeFetch, type AuthorizeEnv } from "../../auth";

type Tool = {
  name: string;
  description: string;
  inputSchema: object;
};

const methodsEnum = (methods: string[]) => ({ type: "string", enum: methods });

export const TOOLS: Tool[] = [
  {
    name: "authorize_health",
    description: "Check authorize service health.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "authorize_github",
    description: "Proxy a request to the GitHub adapter via authorize (/api/v1/github/*).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Sub-path below /api/v1/github (e.g. '/repos/owner/repo/issues')" },
        method: methodsEnum(["GET", "POST"]),
        body: { type: "object", description: "Request body for POST" },
      },
      required: ["path", "method"],
    },
  },
  {
    name: "authorize_google_drive",
    description: "Proxy a request to the Google Drive adapter via authorize (/api/v1/google-drive/*).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Method path (e.g. '/files')" },
        method: methodsEnum(["GET", "POST"]),
        body: { type: "object", description: "Request body for POST" },
      },
      required: ["path", "method"],
    },
  },
  {
    name: "authorize_r2_s3",
    description: "Proxy a request to the R2 S3 adapter via authorize (/api/v1/cloudflare-r2-adapter/s3/*). Handles object operations such as r2_file_list, r2_file_get, r2_file_save, r2_file_delete.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Operation name or sub-path (e.g. 'r2_file_list', 'r2_file_get')" },
        method: methodsEnum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        body: { type: "object", description: "Request body" },
      },
      required: ["path", "method"],
    },
  },
  {
    name: "authorize_r2_control",
    description: "Proxy a request to the R2 control-plane adapter via authorize (/api/v1/cloudflare-r2-adapter/control/*). Handles bucket management operations.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Control operation path" },
        method: methodsEnum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        body: { type: "object", description: "Request body" },
      },
      required: ["path", "method"],
    },
  },
  {
    name: "authorize_d1",
    description: "Proxy a request to the D1 adapter via authorize (/api/v1/d1/*). Handles Cloudflare D1 database operations.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "D1 operation path" },
        method: methodsEnum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        body: { type: "object", description: "Request body" },
      },
      required: ["path", "method"],
    },
  },
];

const BASE_PATHS: Record<string, string> = {
  authorize_health: "/health",
  authorize_github: "/api/v1/github",
  authorize_google_drive: "/api/v1/google-drive",
  authorize_r2_s3: "/api/v1/cloudflare-r2-adapter/s3",
  authorize_r2_control: "/api/v1/cloudflare-r2-adapter/control",
  authorize_d1: "/api/v1/d1",
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  env: AuthorizeEnv,
): Promise<ToolResult> {
  const basePath = BASE_PATHS[name];
  if (!basePath) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }

  const isHealth = name === "authorize_health";
  const subPath = String(args.path ?? "").replace(/^\/+/, "").replace(/\.\./g, "");
  const path = isHealth ? basePath : `${basePath}/${subPath}`;
  const method = isHealth ? "GET" : String(args.method ?? "GET");
  const body = args.body !== undefined ? JSON.stringify(args.body) : undefined;

  try {
    const response = await authorizeFetch(env, { path, method, body });
    const text = await response.text();
    if (!response.ok) {
      return { content: [{ type: "text", text: `Error ${response.status}: ${text}` }], isError: true };
    }
    return { content: [{ type: "text", text }] };
  } catch (e) {
    return { content: [{ type: "text", text: String(e) }], isError: true };
  }
}
