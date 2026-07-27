import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Scaffold stub (leaf 01). Config loading (02), providers (04), file packer (03),
// sessions/metrics (05) and the three delegate tools analyze/query/resume (06) are
// wired in on top of this in later leaves. For now this starts a bare MCP server
// over stdio so the package builds, boots and completes an MCP handshake.

const SERVER_NAME = "delegate-mcp";
const SERVER_VERSION = "0.1.0";

async function main(): Promise<void> {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  // stderr only — stdout is reserved for the MCP JSON-RPC stream.
  console.error(`[${SERVER_NAME}] fatal:`, err);
  process.exit(1);
});
