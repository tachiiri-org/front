import { authorizeFetch, type AuthorizeEnv } from "../../session";
import {
  buildGitHubLoginUrl,
  buildGitHubConnectUrl,
  buildGoogleLoginUrl,
  buildMicrosoftLoginUrl,
  readGitHubSession,
  readGitHubConnectSession,
  readGoogleSession,
} from "../../identify";

type Tool = {
  name: string;
  description: string;
  inputSchema: object;
};

const methodsEnum = (methods: string[]) => ({ type: "string", enum: methods });

export const TOOLS: Tool[] = [
  {
    name: "authorize_github_login",
    description:
      "Generate the public front GitHub login URL (scope: read:user — identity only). Open the URL in a browser to authenticate with GitHub identity.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "authorize_github_connect",
    description:
      "Generate the public front GitHub connect URL for resource access. Open the URL in a browser to authorize GitHub resource access (repo etc.).",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "GitHub OAuth scopes space-separated (default: 'repo read:user')" },
      },
    },
  },
  {
    name: "authorize_google_login",
    description:
      "Generate the public front Google login URL (scope: openid email profile). Open the URL in a browser to authenticate with Google identity.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "authorize_microsoft_login",
    description:
      "Generate the public front Microsoft login URL (OIDC — openid email profile). Open the URL in a browser to authenticate with a Microsoft account.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
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
    description: "Proxy a request to the D1 adapter via authorize (/api/v1/d1/*). Handles Cloudflare D1 database operations. Encrypted fields (enc:v1:... prefix) are automatically decrypted when IDENTITY_ENCRYPTION_KEY is configured.",
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
  {
    name: "authorize_backend",
    description: "Proxy a request to a backend API endpoint (/api/v1/*). Values returned by the backend (e.g. screen names) are already decrypted. Use this instead of authorize_d1 when you need decrypted data. Example: GET screens to list all screens with decrypted names.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Sub-path below /api/v1 (e.g. 'screens', 'screens/{id}')" },
        method: methodsEnum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        body: { type: "object", description: "Request body for POST/PUT/PATCH" },
      },
      required: ["path", "method"],
    },
  },
];

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function resolveSecret(value: string | { get(): Promise<string> } | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value.get();
}

async function loadDecryptKey(encKeySecret: string | { get(): Promise<string> } | undefined): Promise<CryptoKey | null> {
  const hex = await resolveSecret(encKeySecret);
  if (!hex) return null;
  return crypto.subtle.importKey('raw', hexToBytes(hex), { name: 'AES-GCM' }, false, ['decrypt']);
}

async function decryptValue(encoded: string, key: CryptoKey): Promise<string> {
  const combined = fromBase64Url(encoded.slice(7)); // strip "enc:v1:"
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12),
  );
  return new TextDecoder().decode(plaintext);
}

async function decryptJsonValues(text: string, key: CryptoKey): Promise<string> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return text; }
  async function walk(val: unknown): Promise<unknown> {
    if (typeof val === 'string' && val.startsWith('enc:v1:')) {
      try { return await decryptValue(val, key); } catch { return val; }
    }
    if (Array.isArray(val)) return Promise.all(val.map(walk));
    if (val && typeof val === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        result[k] = await walk(v);
      }
      return result;
    }
    return val;
  }
  return JSON.stringify(await walk(parsed), null, 2);
}

const BASE_PATHS: Record<string, string> = {
  authorize_health: "/health",
  authorize_github: "/api/v1/github",
  authorize_r2_s3: "/api/v1/cloudflare-r2-adapter/s3",
  authorize_r2_control: "/api/v1/cloudflare-r2-adapter/control",
  authorize_d1: "/api/v1/d1",
  authorize_backend: "/api/v1",
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  env: AuthorizeEnv,
  request?: Request,
): Promise<ToolResult> {
  if (name === "authorize_github_login") {
    try {
      const url = buildGitHubLoginUrl(env);
      return {
        content: [
          {
            type: "text",
            text: `Open this URL in your browser to authenticate with GitHub (identity only):\n${url}`,
          },
        ],
      };
    } catch (error) {
      return { content: [{ type: "text", text: String(error) }], isError: true };
    }
  }

  if (name === "authorize_github_connect") {
    const scope = String(args.scope ?? "repo read:user");
    try {
      const url = buildGitHubConnectUrl(env, scope);
      return {
        content: [
          {
            type: "text",
            text: `Open this URL in your browser to connect GitHub resource access:\n${url}`,
          },
        ],
      };
    } catch (error) {
      return { content: [{ type: "text", text: String(error) }], isError: true };
    }
  }

  if (name === "authorize_google_login") {
    try {
      const url = buildGoogleLoginUrl(env);
      return {
        content: [
          {
            type: "text",
            text: `Open this URL in your browser to authenticate with Google:\n${url}`,
          },
        ],
      };
    } catch (error) {
      return { content: [{ type: "text", text: String(error) }], isError: true };
    }
  }

  if (name === "authorize_microsoft_login") {
    try {
      const url = buildMicrosoftLoginUrl(env);
      return {
        content: [
          {
            type: "text",
            text: `Open this URL in your browser to authenticate with Microsoft:\n${url}`,
          },
        ],
      };
    } catch (error) {
      return { content: [{ type: "text", text: String(error) }], isError: true };
    }
  }

  const basePath = BASE_PATHS[name];
  if (!basePath) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }

  const isHealth = name === "authorize_health";
  const subPath = String(args.path ?? "").replace(/^\/+/, "").replace(/\.\./g, "");
  const path = isHealth ? basePath : `${basePath}/${subPath}`;
  const method = isHealth ? "GET" : String(args.method ?? "GET");
  const body = args.body !== undefined ? JSON.stringify(args.body) : undefined;

  const headers: Record<string, string> = {};
  if (name === "authorize_github") {
    // Prefer connect session (resource access scopes), fall back to login session
    const connectSession = await readGitHubConnectSession(request ?? null, env);
    if (connectSession) {
      headers["x-github-access-token"] = connectSession.accessToken;
    } else {
      const session = await readGitHubSession(request ?? null, env);
      if (!session) {
        return {
          content: [
            {
              type: "text",
              text: "GitHub session not found. Run authorize_github_login first, then authorize_github_connect for resource access.",
            },
          ],
          isError: true,
        };
      }
      headers["x-github-access-token"] = session.accessToken;
    }
  }

  try {
    const response = await authorizeFetch(env, { path, method, body, headers });
    const text = await response.text();
    if (!response.ok) {
      return { content: [{ type: "text", text: `Error ${response.status}: ${text}` }], isError: true };
    }
    if (name === "authorize_d1" && text.includes("enc:v1:")) {
      const decKey = await loadDecryptKey(env.IDENTITY_ENCRYPTION_KEY);
      if (decKey) {
        const decrypted = await decryptJsonValues(text, decKey);
        return { content: [{ type: "text", text: decrypted }] };
      }
    }
    return { content: [{ type: "text", text }] };
  } catch (e) {
    return { content: [{ type: "text", text: String(e) }], isError: true };
  }
}
