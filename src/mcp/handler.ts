import type { AuthorizeEnv } from "../auth";
import { TOOLS, callTool } from "./tools/authorize";

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
    result = { tools: TOOLS };
  } else if (body.method === "tools/call") {
    const { name, arguments: args } = body.params as {
      name: string;
      arguments: Record<string, unknown>;
    };
    result = await callTool(name, args, env);
  } else {
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32601, message: "Method not found" },
    });
  }

  return Response.json({ jsonrpc: "2.0", id: body.id, result });
}
