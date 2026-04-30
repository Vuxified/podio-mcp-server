import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createServer } from "./server.js";
import { log } from "./utils/logger.js";

// Load .env from project root relative to this file's location (not CWD)
// so the server works when launched from any directory.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

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

    // Bearer auth: enforce only when MCP_AUTH_TOKEN is set so backward-compat
    // and stdio-mode (which never reaches this code path) keep working.
    // External callers must send `Authorization: Bearer ${MCP_AUTH_TOKEN}`.
    const expectedToken = process.env.MCP_AUTH_TOKEN;
    if (!expectedToken) {
      process.stderr.write("[WARN] MCP_AUTH_TOKEN not set — /mcp is OPEN to the world\n");
    }
    app.use("/mcp", (req, res, next) => {
      if (!expectedToken) return next();
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${expectedToken}`) {
        return res.status(401).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized" },
          id: null,
        });
      }
      next();
    });

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
