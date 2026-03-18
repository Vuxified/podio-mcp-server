import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { podioApi, lastRateLimit } from "./client/podio-client.js";
import { toMcpError } from "./utils/errors.js";
import { log } from "./utils/logger.js";
import type {
  PodioOrg,
  PodioSpace,
  PodioApp,
} from "./types/podio.js";

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

  server.registerTool(
    "podio_list_organizations",
    {
      title: "List Organizations",
      description:
        "Returns all organizations the authenticated user belongs to. " +
        "Each org includes its name, type, and a list of spaces. " +
        "Use this as the starting point to discover workspaces.",
      inputSchema: {},
    },
    async () => {
      log.info("podio_list_organizations invoked");
      try {
        const response = await podioApi.get<PodioOrg[]>("/org/");
        return {
          content: [{ type: "text" as const, text: withRateLimit(response.data) }],
        };
      } catch (err) {
        log.error("podio_list_organizations failed:", err);
        return toMcpError(err);
      }
    }
  );

  server.registerTool(
    "podio_list_spaces",
    {
      title: "List Spaces",
      description:
        "Returns all spaces (workspaces) the authenticated user can access within an organization. " +
        "Each space includes its name and ID. Use space IDs to list apps.",
      inputSchema: {
        org_id: z.number().describe("Organization ID (from podio_list_organizations)"),
      },
    },
    async ({ org_id }) => {
      log.info("podio_list_spaces invoked", { org_id });
      try {
        const response = await podioApi.get<PodioSpace[]>(`/space/org/${org_id}/`);
        return {
          content: [{ type: "text" as const, text: withRateLimit(response.data) }],
        };
      } catch (err) {
        log.error("podio_list_spaces failed:", err);
        return toMcpError(err);
      }
    }
  );

  server.registerTool(
    "podio_list_apps",
    {
      title: "List Apps",
      description:
        "Returns all apps within a space. Each app includes its name, ID, and status. " +
        "Use app IDs to get field definitions or work with items.",
      inputSchema: {
        space_id: z.number().describe("Space ID (from podio_list_spaces)"),
        include_inactive: z
          .boolean()
          .optional()
          .describe("Include inactive apps (default: false)"),
      },
    },
    async ({ space_id, include_inactive }) => {
      log.info("podio_list_apps invoked", { space_id, include_inactive });
      try {
        const response = await podioApi.get<PodioApp[]>(`/app/space/${space_id}/`, {
          params: { include_inactive: include_inactive ?? false },
        });
        return {
          content: [{ type: "text" as const, text: withRateLimit(response.data) }],
        };
      } catch (err) {
        log.error("podio_list_apps failed:", err);
        return toMcpError(err);
      }
    }
  );

  server.registerTool(
    "podio_get_app",
    {
      title: "Get App Details",
      description:
        "Returns full app details including all field definitions with types, settings, and option IDs. " +
        "IMPORTANT: For category fields, the settings.options array contains the option IDs needed for " +
        "creating/updating items. Always call this before creating items to learn the field structure.",
      inputSchema: {
        app_id: z.number().describe("App ID (from podio_list_apps)"),
      },
    },
    async ({ app_id }) => {
      log.info("podio_get_app invoked", { app_id });
      try {
        const response = await podioApi.get<PodioApp>(`/app/${app_id}`, {
          params: { type: "full" },
        });
        return {
          content: [{ type: "text" as const, text: withRateLimit(response.data) }],
        };
      } catch (err) {
        log.error("podio_get_app failed:", err);
        return toMcpError(err);
      }
    }
  );

  return server;
}
