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
  PodioFilterResponse,
  PodioView,
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

  server.registerTool(
    "podio_update_item",
    {
      title: "Update Item",
      description:
        "Updates field values on an existing Podio item. Only include fields you want to change in the fields object " +
        "— omitted fields are left unchanged. Same field format as podio_create_item.",
      inputSchema: {
        item_id: z.number().describe("The Podio item ID to update"),
        fields: z
          .record(z.string(), z.unknown())
          .describe(
            "Field values to update, keyed by external_id or field_id. " +
              "Only include fields you want to change — omitted fields are left unchanged."
          ),
        silent: z
          .boolean()
          .optional()
          .describe("If true, no notifications are generated (default: false)"),
      },
    },
    async ({ item_id, fields, silent }) => {
      log.info("podio_update_item invoked", { item_id });
      try {
        const response = await podioApi.put<unknown>(`/item/${item_id}`, {
          fields,
          silent,
        });
        return {
          content: [{ type: "text" as const, text: withRateLimit(response.data) }],
        };
      } catch (err) {
        log.error("podio_update_item failed:", err);
        return toMcpError(err);
      }
    }
  );

  server.registerTool(
    "podio_delete_item",
    {
      title: "Delete Item",
      description:
        "Permanently deletes a Podio item. This cannot be undone. Returns confirmation of deletion.",
      inputSchema: {
        item_id: z.number().describe("The Podio item ID to delete"),
        silent: z
          .boolean()
          .optional()
          .describe("If true, no notifications are generated (default: false)"),
      },
    },
    async ({ item_id, silent }) => {
      log.info("podio_delete_item invoked", { item_id });
      try {
        await podioApi.delete(`/item/${item_id}`, {
          params: { silent: silent ?? false },
        });
        return {
          content: [
            {
              type: "text" as const,
              text: withRateLimit({ deleted: true, item_id }),
            },
          ],
        };
      } catch (err) {
        log.error("podio_delete_item failed:", err);
        return toMcpError(err);
      }
    }
  );

  server.registerTool(
    "podio_filter_items",
    {
      title: "Filter Items",
      description:
        "Filters items in a Podio app by field conditions. Returns paginated results with total count. " +
        "Use numeric field_ids as filter keys (from podio_get_app). Supports sorting by 'created_on', " +
        "'last_edit_on', or a field_id. " +
        "NOTE: This endpoint has a stricter rate limit (250/hr vs 1000/hr standard). " +
        "Text fields cannot be filtered — use search tools instead.",
      inputSchema: {
        app_id: z.number().describe("App ID to filter items in"),
        filters: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Field filters as object. Keys are numeric field_ids (as strings). " +
              "Values depend on field type: category=[option_id, ...], number={from:X,to:Y}, " +
              "date={from:'YYYY-MM-DD',to:'YYYY-MM-DD'}, app_reference=[item_id, ...]. " +
              "Built-in filters: created_on, created_by. " +
              "NOTE: Text fields cannot be filtered — use Podio search instead."
          ),
        limit: z
          .number()
          .optional()
          .describe("Max items to return (default: 30, max: 500)"),
        offset: z
          .number()
          .optional()
          .describe("Number of items to skip for pagination (default: 0)"),
        sort_by: z
          .string()
          .optional()
          .describe(
            "Sort field: 'created_on', 'last_edit_on', or a numeric field_id as string"
          ),
        sort_desc: z.boolean().optional().describe("Sort descending (default: true)"),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            "Optional list of field external_ids or field_ids to include in each item. Reduces response size."
          ),
      },
    },
    async ({ app_id, filters, limit, offset, sort_by, sort_desc, fields }) => {
      log.info("podio_filter_items invoked", { app_id, limit, offset });
      try {
        const cappedLimit = Math.min(limit ?? 30, 500);
        const response = await podioApi.post<PodioFilterResponse>(
          `/item/app/${app_id}/filter/`,
          {
            filters,
            limit: cappedLimit,
            offset: offset ?? 0,
            sort_by,
            sort_desc,
          }
        );

        let result = response.data;

        if (fields && fields.length > 0) {
          const fieldSet = new Set(fields);
          result = {
            ...result,
            items: result.items.map((item) => ({
              ...item,
              fields: item.fields.filter(
                (f) => fieldSet.has(f.external_id) || fieldSet.has(String(f.field_id))
              ),
            })),
          };
        }

        return {
          content: [{ type: "text" as const, text: withRateLimit(result) }],
        };
      } catch (err) {
        log.error("podio_filter_items failed:", err);
        return toMcpError(err);
      }
    }
  );

  server.registerTool(
    "podio_list_views",
    {
      title: "List Views",
      description:
        "Lists all saved views for a Podio app. Returns view IDs, names, and item counts. " +
        "Use view IDs with podio_filter_items_by_view to filter items using a saved view's criteria.",
      inputSchema: {
        app_id: z.number().describe("App ID to list views for"),
        include_standard_views: z
          .boolean()
          .optional()
          .describe("Include built-in views like 'All items' (default: true)"),
      },
    },
    async ({ app_id, include_standard_views }) => {
      log.info("podio_list_views invoked", { app_id });
      try {
        const response = await podioApi.get<PodioView[]>(`/view/app/${app_id}/`, {
          params: { include_standard_views: include_standard_views ?? true },
        });
        return {
          content: [{ type: "text" as const, text: withRateLimit(response.data) }],
        };
      } catch (err) {
        log.error("podio_list_views failed:", err);
        return toMcpError(err);
      }
    }
  );

  server.registerTool(
    "podio_filter_items_by_view",
    {
      title: "Filter Items by View",
      description:
        "Filters items using a saved Podio view's criteria. The view defines the filter conditions — " +
        "you only need to specify pagination and sorting. " +
        "Use podio_list_views first to discover available view IDs.",
      inputSchema: {
        app_id: z.number().describe("App ID containing the view"),
        view_id: z.number().describe("View ID (from podio_list_views)"),
        limit: z
          .number()
          .optional()
          .describe("Max items to return (default: 30, max: 500)"),
        offset: z
          .number()
          .optional()
          .describe("Number of items to skip for pagination (default: 0)"),
        sort_by: z
          .string()
          .optional()
          .describe("Sort field: 'created_on', 'last_edit_on', or a numeric field_id"),
        sort_desc: z.boolean().optional().describe("Sort descending (default: true)"),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            "Optional list of field external_ids or field_ids to include. Reduces response size."
          ),
      },
    },
    async ({ app_id, view_id, limit, offset, sort_by, sort_desc, fields }) => {
      log.info("podio_filter_items_by_view invoked", { app_id, view_id, limit, offset });
      try {
        const cappedLimit = Math.min(limit ?? 30, 500);
        const response = await podioApi.post<PodioFilterResponse>(
          `/item/app/${app_id}/filter/${view_id}/`,
          {
            limit: cappedLimit,
            offset: offset ?? 0,
            sort_by,
            sort_desc,
          }
        );

        let result = response.data;

        if (fields && fields.length > 0) {
          const fieldSet = new Set(fields);
          result = {
            ...result,
            items: result.items.map((item) => ({
              ...item,
              fields: item.fields.filter(
                (f) => fieldSet.has(f.external_id) || fieldSet.has(String(f.field_id))
              ),
            })),
          };
        }

        return {
          content: [{ type: "text" as const, text: withRateLimit(result) }],
        };
      } catch (err) {
        log.error("podio_filter_items_by_view failed:", err);
        return toMcpError(err);
      }
    }
  );

  return server;
}
