import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
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
  if (process.env.MCP_TRANSPORT === "http") {
    const PORT = parseInt(process.env.PORT ?? "3000", 10);
    const app = createMcpExpressApp({ host: "0.0.0.0" });

    app.post("/mcp", async (req, res) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    app.get("/mcp", (_req, res) => {
      res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method Not Allowed" }, id: null });
    });

    app.delete("/mcp", (_req, res) => {
      res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method Not Allowed" }, id: null });
    });

    app.listen(PORT, "0.0.0.0", () => {
      process.stderr.write(`podio-mcp server running via HTTP transport on port ${PORT}\n`);
    });
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write("podio-mcp server running via stdio transport\n");
  }
}

main().catch((err: Error) => {
  log.error("Fatal startup error:", err.message);
  process.exit(1);
});
