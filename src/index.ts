import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { log } from "./utils/logger.js";

process.on("uncaughtException", (err) => {
  process.stderr.write(`[FATAL] Uncaught exception: ${err.message}\n${err.stack ?? ""}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[FATAL] Unhandled rejection: ${String(reason)}\n`);
});

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("podio-mcp server running via stdio transport\n");
}

main().catch((err: Error) => {
  log.error("Fatal startup error:", err.message);
  process.exit(1);
});
