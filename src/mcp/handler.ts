import type { AuthorizeEnv } from "../auth";
import { verifyInternalToken } from "../auth/token";
import { TOOLS, callTool } from "./tools/authorize";
import { GRAPH_TOOLS, callGraphTool } from "./tools/graph";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
};

export async function handleMcp(request: Request, env: AuthorizeEnv): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Resolve actor from Bearer token if present
  let mcpEnv: AuthorizeEnv = env;
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const claims = await verifyInternalToken(env, token);
    if (!claims) {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: invalid or expired token" } },
        { status: 401 },
      );
    }
    const scopes = Array.isArray(claims.scopes)
      ? claims.scopes
      : typeof claims.scopes === "string"
      ? claims.scopes.split(" ")
      : [];
    mcpEnv = { ...env, actor: { tenant: claims.tenant_id, userId: claims.subject_id, scopes } };
  }

  const body = (await request.json()) as JsonRpcRequest;

  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  let result: unknown;

  if (body.method === "initialize") {
    result = {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "front", version: "1.0.0" },
    };
  } else if (body.method === "tools/list") {
    result = { tools: [...TOOLS, ...GRAPH_TOOLS] };
  } else if (body.method === "tools/call") {
    const { name, arguments: args } = body.params as {
      name: string;
      arguments: Record<string, unknown>;
    };
    result = name.startsWith("graph_")
      ? await callGraphTool(name, args, mcpEnv)
      : await callTool(name, args, mcpEnv, request);
  } else {
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32601, message: "Method not found" },
    });
  }

  return Response.json({ jsonrpc: "2.0", id: body.id, result });
}
