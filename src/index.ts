import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer, resolveContext } from "./tools.js";

/**
 * Server entrypoint (leaf 06, seam S-TOOLS). Replaces the leaf 01 bare-boot stub.
 *
 * On start: resolve + load the config (S-CONFIG) FAIL-LOUD — a bad or missing config
 * throws, `main` rejects, and the process exits non-zero WITHOUT ever serving. On success
 * it builds the provider pool, registers the three delegate tools (analyze/query/resume)
 * and serves them over stdio.
 *
 * The build (S-PKG) bundles this single entry; all wiring lives in `tools.ts` so importing
 * that module in tests never triggers this fail-loud startup. stdout is reserved for the MCP
 * JSON-RPC stream — diagnostics go to stderr only.
 */

const SERVER_NAME = "delegate-mcp";

async function main(): Promise<void> {
  const ctx = resolveContext();
  const server = createServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error(`[${SERVER_NAME}] fatal:`, err);
  process.exit(1);
});
