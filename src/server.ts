import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { podioApi, lastRateLimit } from "./client/podio-client.js";
import { toMcpError } from "./utils/errors.js";
import { log } from "./utils/logger.js";

function withRateLimit(data: unknown): string {
  return JSON.stringify({
    data,
    _meta: {
      rate_limit_remaining: lastRateLimit.remaining,
      rate_limit_total: lastRateLimit.limit,
    },
  });
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "podio-mcp", version: "1.0.0" },
    { capabilities: { logging: {} } }
  );

  server.registerTool(
    "podio_health_check",
    {
      title: "Podio Health Check",
      description:
        "Verify the MCP server can authenticate with Podio and make an API call. " +
        "Returns the authenticated user's display name, email, and current rate limit status. " +
        "Use this tool first to confirm the server is working before using other tools.",
      inputSchema: {},
    },
    async () => {
      log.info("podio_health_check invoked");
      try {
        const response = await podioApi.get<{
          user?: { user_id?: number; mail?: string[] };
          profile?: { name?: string };
        }>("/user/status");

        const result = {
          status: "ok",
          user: {
            user_id: response.data.user?.user_id,
            name: response.data.profile?.name,
            email: response.data.user?.mail?.[0],
          },
        };

        return {
          content: [{ type: "text" as const, text: withRateLimit(result) }],
        };
      } catch (err) {
        log.error("podio_health_check failed:", err);
        return toMcpError(err);
      }
    }
  );

  return server;
}
