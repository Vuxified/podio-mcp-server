import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { podioApi, lastRateLimit } from "./client/podio-client.js";
import { toMcpError } from "./utils/errors.js";
import { log } from "./utils/logger.js";
import type {
  PodioOrg,
  PodioSpace,
  PodioApp,
  PodioItem,
  CreateItemResponse,
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

  server.registerTool(
    "podio_create_item",
    {
      title: "Create Item",
      description:
        "Creates a new item in a Podio app. The fields object maps field external_ids (or field_ids) to values. " +
        "IMPORTANT: Call podio_get_app first to learn field types and option IDs. " +
        "Field format varies by type: text='string', number=42, date={start:'YYYY-MM-DD'}, " +
        "category=option_id (integer from app field settings), money={value:100,currency:'USD'}, " +
        "app_reference=[{item_id:123}].",
      inputSchema: {
        app_id: z.number().describe("App ID to create the item in"),
        fields: z
          .record(z.string(), z.unknown())
          .describe(
            "Field values keyed by external_id or field_id. Use podio_get_app to learn field types and option IDs. " +
              "Examples: text='string', number=42, date={start:'2026-04-01'}, category=option_id, money={value:100,currency:'USD'}"
          ),
        tags: z.array(z.string()).optional().describe("Optional tags to apply to the item"),
        silent: z
          .boolean()
          .optional()
          .describe("If true, no notifications are generated (default: false)"),
      },
    },
    async ({ app_id, fields, tags, silent }) => {
      log.info("podio_create_item invoked", { app_id });
      try {
        const response = await podioApi.post<CreateItemResponse>(
          `/item/app/${app_id}/`,
          { fields, tags, silent }
        );
        return {
          content: [{ type: "text" as const, text: withRateLimit(response.data) }],
        };
      } catch (err) {
        log.error("podio_create_item failed:", err);
        return toMcpError(err);
      }
    }
  );

  server.registerTool(
    "podio_get_item",
    {
      title: "Get Item",
      description:
        "Retrieves a Podio item by ID. Optionally pass a fields array of external_ids or field_ids to return only " +
        "specific fields (reduces response size). Does NOT mark the item as viewed (preserves notifications).",
      inputSchema: {
        item_id: z.number().describe("The Podio item ID"),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            "Optional list of field external_ids or field_ids to include. If omitted, all fields are returned. " +
              "Use this to reduce response size."
          ),
      },
    },
    async ({ item_id, fields }) => {
      log.info("podio_get_item invoked", { item_id, fields });
      try {
        const response = await podioApi.get<PodioItem>(`/item/${item_id}`, {
          params: { mark_as_viewed: false },
        });

        let result = response.data;

        if (fields && fields.length > 0) {
          const fieldSet = new Set(fields);
          result = {
            ...result,
            fields: result.fields.filter(
              (f) => fieldSet.has(f.external_id) || fieldSet.has(String(f.field_id))
            ),
          };
        }

        return {
          content: [{ type: "text" as const, text: withRateLimit(result) }],
        };
      } catch (err) {
        log.error("podio_get_item failed:", err);
        return toMcpError(err);
      }
    }
  );

  return server;
}
