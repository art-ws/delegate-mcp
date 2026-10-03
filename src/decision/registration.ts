import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, type ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import { decisionInputJsonSchema, decisionOutputJsonSchema } from "./schemas.js";

/** Owned SDK bridge. Call during initial tool registration, before legacy tools.
 * Uses only public SDK APIs; never reads private registries. The original list
 * producer and legacy call dispatch/validation remain SDK-owned. SDK's record
 * parser drops reserved argument keys; S3 must see decision's original JSON.
 */
export function withDecisionSchemas(server: McpServer, register: () => void): void {
  const rpc = server.server;
  rpc.assertCanSetRequestHandler("tools/list");
  rpc.assertCanSetRequestHandler("tools/call");
  const original = rpc.setRequestHandler;
  const install = original.bind(rpc);
  rpc.setRequestHandler = (schema, handler) => {
    if ((schema as unknown) === ListToolsRequestSchema) {
      install(ListToolsRequestSchema, async (request, extra) => {
        const result = await handler(request as never, extra) as ListToolsResult;
        return { ...result, tools: result.tools.map((tool) => tool.name === "decision" ? {
          ...tool, inputSchema: decisionInputJsonSchema, outputSchema: decisionOutputJsonSchema,
        } : tool) };
      });
    } else if ((schema as unknown) === CallToolRequestSchema) {
      // Server.setRequestHandler still applies canonical JSON-RPC validation
      // before this handler. Keep params intact through Protocol's first parse.
      const rawParamsSchema = CallToolRequestSchema.extend({ params: z.unknown() });
      install(rawParamsSchema, (request, extra) => {
        const raw = request as z.infer<typeof CallToolRequestSchema>;
        if (raw.params.name === "decision") {
          if (raw.params.task) throw new McpError(ErrorCode.InvalidParams, "Tool decision does not support tasks.");
          return handler(raw as never, extra);
        }
        return handler(CallToolRequestSchema.parse(raw) as never, extra);
      });
    } else install(schema, handler);
  };
  try { register(); } finally { rpc.setRequestHandler = original; }
}
