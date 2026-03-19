# Podio MCP Server

An MCP server that gives an MCP client direct access to the Podio API — create, read, update, delete items and more through natural language.

![Node.js 22+](https://img.shields.io/badge/node-22%2B-green) ![License: MIT](https://img.shields.io/badge/license-MIT-blue) ![Tools: 20](https://img.shields.io/badge/tools-20-orange)

---

## Table of Contents

- [Quick Start](#quick-start)
- [Setup — Local (stdio)](#setup--local-stdio)
- [Setup — Remote (HTTPS/EC2)](#setup--remote-httpsec2)
- [Architecture](#architecture)
- [Tool Reference](#tool-reference)
- [Workflow Examples](#workflow-examples)
- [Contributing](#contributing)

---

## Quick Start

**Prerequisites:** Node.js 22+, Podio developer account (for API credentials), npm

```bash
# 1. Clone and enter the project
git clone https://github.com/your-username/podio-mcp-server.git
cd podio-mcp-server

# 2. Install dependencies
npm install

# 3. Install the pre-commit hook (auto-regenerates docs on commit)
npm run setup

# 4. Copy env template and fill in your Podio API credentials
cp .env.example .env
# Edit .env with your PODIO_CLIENT_ID and PODIO_CLIENT_SECRET

# 5. Authenticate with Podio (opens browser for OAuth2 login)
npm run auth

# 6. Start the server
npm start
```

---

## Setup — Local (stdio)

The stdio transport is the default mode and is used with MCP clients running locally.

**1. Create `.env` from the template:**

```bash
cp .env.example .env
```

**2. Fill in the required environment variables:**

| Variable | Description |
|----------|-------------|
| `PODIO_CLIENT_ID` | From your Podio API key page (Settings > API Keys) |
| `PODIO_CLIENT_SECRET` | From your Podio API key page |
| `PODIO_REDIRECT_URI` | Must be exactly `http://localhost:8888/callback` |
| `PODIO_TOKEN_PATH` | Token file location (default: `.podio-tokens.json`) |

Leave `MCP_TRANSPORT` empty or unset for stdio mode.

**3. Authenticate:**

```bash
npm run auth
```

This opens a browser window, completes the OAuth2 flow (including Google SSO), and saves tokens to the path specified by `PODIO_TOKEN_PATH`.

**4. Build and add to an MCP client Code:**

```bash
npm run build
```

Add the following to your an MCP client Code MCP configuration (`your MCP client config` or equivalent):

```json
{
  "mcpServers": {
    "podio": {
      "command": "node",
      "args": ["/absolute/path/to/podio-mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

Replace `/absolute/path/to` with the actual path to your clone. Run `npm run build` first if `dist/` does not exist.

---

## Setup — Remote (HTTPS/EC2)

The remote mode runs the server on an EC2 instance behind Nginx with SSL, and connects via Streamable HTTP.

**Prerequisites:**

- AWS CLI configured with appropriate credentials
- SSH key pair for EC2 access
- A domain with an A record pointing to your EC2 Elastic IP

**1. Run the automated deploy script:**

```bash
npm run deploy
```

This script automates the full deployment: EC2 instance provisioning, Node.js 22 installation, Nginx reverse proxy configuration, Certbot SSL certificates, and systemd service setup. The default domain is `mcp.example.com` — change it in `deploy/deploy.sh` before running.

**2. Add to an MCP client Code (remote config):**

```json
{
  "mcpServers": {
    "podio-remote": {
      "type": "streamableHttp",
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

**Transport switching:** The `MCP_TRANSPORT` environment variable controls which transport is used. Omit or leave blank for stdio (local), set to `http` for Streamable HTTP (EC2/remote).

---

## Architecture

```
an MCP client (Desktop/Code)
  │
  ▼
MCP Protocol (stdio or Streamable HTTP)
  │
  ▼
podio-mcp-server
├── src/server.ts        ← 20 tool registrations (Zod schemas)
├── src/auth/            ← OAuth2 flow + token manager
├── src/client/          ← Axios interceptors, rate limiting
├── src/types/           ← Podio API type definitions
└── src/utils/           ← Error handling, logging (stderr)
  │
  ▼
Podio REST API (api.podio.com)
```

**Key design decisions:**

- OAuth2 authorization code flow — supports Google SSO (App auth does not)
- Automatic token refresh with 8-hour TTL
- All logging to stderr — stdout reserved for JSON-RPC over stdio
- Rate limit metadata included in every tool response (`_meta.rate_limit_remaining`)
- Stateless per-request HTTP transport for EC2 deployment (no session state needed)

---

## Tool Reference

The server exposes 20 tools organized by Podio domain. Parameters, types, and descriptions are extracted directly from source code.

<!-- GENERATED:TOOL-REFERENCE:START -->
## Utility

### `podio_health_check`

**Podio Health Check**

Verify the MCP server can authenticate with Podio and make an API call. Returns the authenticated user's display name, email, and current rate limit status. Use this tool first to confirm the server is working before using other tools.

_No parameters required._

**Example:**
```json
// Request
{}

// Response (truncated)
{ "data": { "status": "ok", "user": { "name": "Jane Smith", "email": "jane@acme.com" } }, "_meta": { "rate_limit_remaining": 499, "rate_limit_total": 500 } }
```

## Organizations

### `podio_list_organizations`

**List Organizations**

Returns all organizations the authenticated user belongs to. Each org includes its name, type, and a list of spaces. Use this as the starting point to discover workspaces.

_No parameters required._

**Example:**
```json
// Request
{}

// Response (truncated)
{ "data": [{ "org_id": 12345, "name": "Acme Corp", "url": "https://podio.com/acmecorp", ... }], "_meta": { ... } }
```

### `podio_list_spaces`

**List Spaces**

Returns all spaces (workspaces) the authenticated user can access within an organization. Each space includes its name and ID. Use space IDs to list apps.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `org_id` | `number` | Yes | Organization ID (from podio_list_organizations) |

**Example:**
```json
// Request
{ "org_id": 12345 }

// Response (truncated)
{ "data": [{ "space_id": 67890, "name": "Engineering", "org_id": 12345, ... }], "_meta": { ... } }
```

## Apps

### `podio_list_apps`

**List Apps**

Returns all apps within a space. Each app includes its name, ID, and status. Use app IDs to get field definitions or work with items.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `space_id` | `number` | Yes | Space ID (from podio_list_spaces) |
| `include_inactive` | `boolean` | No | Include inactive apps (default: false) |

**Example:**
```json
// Request
{ "space_id": 67890 }

// Response (truncated)
{ "data": [{ "app_id": 11111, "config": { "name": "Bug Tracker", "item_name": "Bug" }, ... }], "_meta": { ... } }
```

### `podio_get_app`

**Get App Details**

Returns full app details including all field definitions with types, settings, and option IDs. IMPORTANT: For category fields, the settings.options array contains the option IDs needed for creating/updating items. Always call this before creating items to learn the field structure.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app_id` | `number` | Yes | App ID (from podio_list_apps) |

**Example:**
```json
// Request
{ "app_id": 11111 }

// Response (truncated)
{ "data": { "app_id": 11111, "config": { "name": "Bug Tracker" }, "fields": [{ "field_id": 1, "type": "text", "label": "Title" }, ...] }, "_meta": { ... } }
```

## Items

### `podio_create_item`

**Create Item**

Creates a new item in a Podio app. The fields object maps field external_ids (or field_ids) to values. IMPORTANT: Call podio_get_app first to learn field types and option IDs. Field format varies by type: text='string', number=42, date={start:'YYYY-MM-DD'}, category=option_id (integer from app field settings), money={value:100,currency:'USD'}, app_reference=[{item_id:123}].

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app_id` | `number` | Yes | App ID to create the item in |
| `fields` | `object` | Yes | Field values keyed by external_id or field_id. Use podio_get_app to learn field types and option IDs. Examples: text='string', number=42, date={start:'2026-04-01'}, category=option_id, money={value:100,currency:'USD'} |
| `tags` | `string[]` | No | Optional tags to apply to the item |
| `silent` | `boolean` | No | If true, no notifications are generated (default: false) |

**Example:**
```json
// Request
{ "app_id": 11111, "fields": { "title": "Fix login page" } }

// Response (truncated)
{ "data": { "item_id": 99999, "title": "Fix login page" }, "_meta": { ... } }
```

### `podio_get_item`

**Get Item**

Retrieves a Podio item by ID. Optionally pass a fields array of external_ids or field_ids to return only specific fields (reduces response size). Does NOT mark the item as viewed (preserves notifications).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `item_id` | `number` | Yes | The Podio item ID |
| `fields` | `string[]` | No | Optional list of field external_ids or field_ids to include. If omitted, all fields are returned. Use this to reduce response size. |

**Example:**
```json
// Request
{ "item_id": 99999 }

// Response (truncated)
{ "data": { "item_id": 99999, "title": "Fix login page", "fields": [{ "field_id": 1, "type": "text", "label": "Title", "values": [{ "value": "Fix login page" }] }, ...] }, "_meta": { ... } }
```

### `podio_update_item`

**Update Item**

Updates field values on an existing Podio item. Only include fields you want to change in the fields object — omitted fields are left unchanged. Same field format as podio_create_item.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `item_id` | `number` | Yes | The Podio item ID to update |
| `fields` | `object` | Yes | Field values to update, keyed by external_id or field_id. Only include fields you want to change — omitted fields are left unchanged. |
| `silent` | `boolean` | No | If true, no notifications are generated (default: false) |

**Example:**
```json
// Request
{ "item_id": 99999, "fields": { "priority": 1 } }

// Response (truncated)
{ "data": { "item_id": 99999, "title": "Fix login page" }, "_meta": { ... } }
```

### `podio_delete_item`

**Delete Item**

Permanently deletes a Podio item. This cannot be undone. Returns confirmation of deletion.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `item_id` | `number` | Yes | The Podio item ID to delete |
| `silent` | `boolean` | No | If true, no notifications are generated (default: false) |

**Example:**
```json
// Request
{ "item_id": 99999 }

// Response (truncated)
{ "data": { "deleted": true }, "_meta": { ... } }
```

### `podio_filter_items`

**Filter Items**

Filters items in a Podio app by field conditions. Returns paginated results with total count. Use numeric field_ids as filter keys (from podio_get_app). Supports sorting by 'created_on', 'last_edit_on', or a field_id. NOTE: This endpoint has a stricter rate limit (250/hr vs 1000/hr standard). Text fields cannot be filtered — use search tools instead.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app_id` | `number` | Yes | App ID to filter items in |
| `filters` | `object` | No | Field filters as object. Keys are numeric field_ids (as strings). Values depend on field type: category=[option_id, ...], number={from:X,to:Y}, date={from:'YYYY-MM-DD',to:'YYYY-MM-DD'}, app_reference=[item_id, ...]. Built-in filters: created_on, created_by. NOTE: Text fields cannot be filtered — use Podio search instead. |
| `limit` | `number` | No | Max items to return (default: 30, max: 500) |
| `offset` | `number` | No | Number of items to skip for pagination (default: 0) |
| `sort_by` | `string` | No | Sort field: 'created_on', 'last_edit_on', or a numeric field_id as string |
| `sort_desc` | `boolean` | No | Sort descending (default: true) |
| `fields` | `string[]` | No | Optional list of field external_ids or field_ids to include in each item. Reduces response size. |

**Example:**
```json
// Request
{ "app_id": 11111, "filters": { "priority": [1] }, "limit": 5 }

// Response (truncated)
{ "data": { "total": 42, "filtered": 3, "items": [{ "item_id": 99999, "title": "Fix login page", ... }, ...] }, "_meta": { ... } }
```

### `podio_list_views`

**List Views**

Lists all saved views for a Podio app. Returns view IDs, names, and item counts. Use view IDs with podio_filter_items_by_view to filter items using a saved view's criteria.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app_id` | `number` | Yes | App ID to list views for |
| `include_standard_views` | `boolean` | No | Include built-in views like 'All items' (default: true) |

**Example:**
```json
// Request
{ "app_id": 11111 }

// Response (truncated)
{ "data": [{ "view_id": 5555, "name": "Critical Bugs", "type": "standard", ... }], "_meta": { ... } }
```

### `podio_filter_items_by_view`

**Filter Items by View**

Filters items using a saved Podio view's criteria. The view defines the filter conditions — you only need to specify pagination and sorting. Use podio_list_views first to discover available view IDs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app_id` | `number` | Yes | App ID containing the view |
| `view_id` | `number` | Yes | View ID (from podio_list_views) |
| `limit` | `number` | No | Max items to return (default: 30, max: 500) |
| `offset` | `number` | No | Number of items to skip for pagination (default: 0) |
| `sort_by` | `string` | No | Sort field: 'created_on', 'last_edit_on', or a numeric field_id |
| `sort_desc` | `boolean` | No | Sort descending (default: true) |
| `fields` | `string[]` | No | Optional list of field external_ids or field_ids to include. Reduces response size. |

**Example:**
```json
// Request
{ "app_id": 11111, "view_id": 5555, "limit": 10 }

// Response (truncated)
{ "data": { "total": 20, "filtered": 20, "items": [{ "item_id": 99999, "title": "Fix login page", ... }, ...] }, "_meta": { ... } }
```

## Comments

### `podio_add_comment`

**Add Comment**

Adds a text comment to a Podio item. Returns the new comment ID. Comments appear in the item's activity stream and notify followers.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `item_id` | `number` | Yes | The Podio item ID to comment on |
| `text` | `string` | Yes | Comment text (plain text or rich text HTML) |

**Example:**
```json
// Request
{ "item_id": 99999, "text": "Escalated to Critical" }

// Response (truncated)
{ "data": { "comment_id": 77777 }, "_meta": { ... } }
```

### `podio_get_comments`

**Get Comments**

Retrieves all comments on a Podio item, sorted ascending by creation time. Each comment includes the author, timestamp, and text. Use limit/offset for pagination on items with many comments.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `item_id` | `number` | Yes | The Podio item ID to get comments for |
| `limit` | `number` | No | Max comments to return (default: 50) |
| `offset` | `number` | No | Number of comments to skip (default: 0) |

**Example:**
```json
// Request
{ "item_id": 99999 }

// Response (truncated)
{ "data": [{ "comment_id": 77777, "value": "Escalated to Critical", "created_by": { "name": "Jane Smith" }, ... }], "_meta": { ... } }
```

## Webhooks

### `podio_create_webhook`

**Create Webhook**

Creates a webhook on a Podio app or space. The webhook URL must be a publicly-reachable HTTPS endpoint you control (port 80 or 443). After creation, Podio sends a verification code to your URL. Your webhook receiver must call POST https://api.podio.com/hook/{hook_id}/verify/validate with {code} to activate the webhook. Valid event types for apps: item.create, item.update, item.delete. For spaces: app.create, task.create, task.update, task.delete, member.add, member.remove.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ref_type` | `"app" | "space"` | Yes | Object type to hook: 'app' or 'space' |
| `ref_id` | `number` | Yes | App ID or Space ID to create the webhook on |
| `url` | `string` | Yes | Publicly-reachable webhook URL (must be HTTPS, port 80 or 443) |
| `type` | `string` | Yes | Event type: 'item.create', 'item.update', 'item.delete' (for apps), or 'app.create', 'task.create', etc. (for spaces) |

**Example:**
```json
// Request
{ "ref_type": "app", "ref_id": 11111, "url": "https://hooks.example.com/podio", "type": "item.create" }

// Response (truncated)
{ "data": { "hook_id": 3333, "status": "inactive", "type": "item.create", "url": "https://hooks.example.com/podio" }, "_meta": { ... } }
```

### `podio_list_webhooks`

**List Webhooks**

Lists all webhooks registered on a Podio app or space. Returns each webhook's ID, status (active/inactive), event type, and URL.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ref_type` | `"app" | "space"` | Yes | Object type: 'app' or 'space' |
| `ref_id` | `number` | Yes | App ID or Space ID |

**Example:**
```json
// Request
{ "ref_type": "app", "ref_id": 11111 }

// Response (truncated)
{ "data": [{ "hook_id": 3333, "type": "item.create", "url": "https://hooks.example.com/podio", "status": "active", ... }], "_meta": { ... } }
```

### `podio_delete_webhook`

**Delete Webhook**

Permanently deletes a webhook by ID. This stops all event deliveries to the webhook URL. Cannot be undone.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hook_id` | `number` | Yes | Webhook ID (from podio_create_webhook or podio_list_webhooks) |

**Example:**
```json
// Request
{ "hook_id": 3333 }

// Response (truncated)
{ "data": { "deleted": true }, "_meta": { ... } }
```

## Files

### `podio_attach_file`

**Attach File to Item**

Uploads a local file and attaches it to a Podio item in one operation. Provide the absolute file path on disk and the target item ID. The file is uploaded via multipart to Podio's file API, then attached to the item. Returns the file ID, name, size, and download link. Maximum file size: 100MB.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_path` | `string` | Yes | Absolute path to the file on disk (e.g., /Users/me/report.pdf) |
| `item_id` | `number` | Yes | The Podio item ID to attach the file to |
| `filename` | `string` | No | Override filename (defaults to the file's basename) |

**Example:**
```json
// Request
{ "item_id": 99999, "file_path": "/tmp/report.pdf" }

// Response (truncated)
{ "data": { "file_id": 44444, "name": "report.pdf", "size": 102400 }, "_meta": { ... } }
```

## Search

### `podio_search_global`

**Search Globally**

Searches across all accessible Podio content by keyword. Returns items, tasks, files, and other objects matching the query, each with a title, type, direct link, and app/space/org context. IMPORTANT: Results contain titles and context only — use podio_get_item to retrieve full field values. Max 20 results per call; use offset for pagination. NOTE: Rate-limited at 250 calls/hour (vs 1000/hour for other tools). This is the only way to search text fields — podio_filter_items cannot do text search.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | Yes | Keyword or phrase to search for |
| `ref_type` | `"item" | "task" | "file" | "conversation" | "profile" | "app" | "status"` | No | Restrict results to a specific content type (optional) |
| `limit` | `number` | No | Max results to return (default: 20, max: 20) |
| `offset` | `number` | No | Pagination offset (default: 0) |

**Example:**
```json
// Request
{ "query": "login page", "limit": 5 }

// Response (truncated)
{ "data": [{ "type": "item", "id": 99999, "title": "Fix login page", "app": { "name": "Bug Tracker" }, ... }], "_meta": { ... } }
```

### `podio_search_app`

**Search in App**

Searches within a specific Podio app by keyword. Returns items and tasks matching the query, each with a title, type, and direct link. IMPORTANT: Results contain titles only — use podio_get_item to retrieve full field values. Max 20 results per call; use offset for pagination. NOTE: Rate-limited at 250 calls/hour.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `app_id` | `number` | Yes | App ID to search within (from podio_list_apps) |
| `query` | `string` | Yes | Keyword or phrase to search for |
| `ref_type` | `"item" | "task" | "file" | "status"` | No | Restrict results to a specific content type (optional) |
| `limit` | `number` | No | Max results to return (default: 20, max: 20) |
| `offset` | `number` | No | Pagination offset (default: 0) |

**Example:**
```json
// Request
{ "app_id": 11111, "query": "login page", "limit": 5 }

// Response (truncated)
{ "data": [{ "type": "item", "id": 99999, "title": "Fix login page", ... }], "_meta": { ... } }
```

<!-- GENERATED:TOOL-REFERENCE:END -->

**Permission and access notes:**

- All tools require valid OAuth2 tokens — run `npm run auth` before use
- `podio_filter_items`: Stricter rate limit (250 calls/hour vs standard 1000)
- `podio_search_global` / `podio_search_app`: 250 calls/hour; results contain titles only
- `podio_create_webhook`: Webhook URL must be HTTPS, publicly reachable on port 80 or 443
- `podio_attach_file`: Max 100MB; requires read access to the local file path

---

## Workflow Examples

### Example 1 — Discover a workspace

```
1. podio_list_organizations
   → find "Acme Corp" (org_id: 12345)

2. podio_list_spaces({ org_id: 12345 })
   → find "Engineering" (space_id: 67890)

3. podio_list_apps({ space_id: 67890 })
   → find "Bug Tracker" (app_id: 11111)

4. podio_get_app({ app_id: 11111 })
   → see fields: Title (text), Priority (category, options: 1=Low, 2=Medium, 3=Critical), Assignee (contact)
```

### Example 2 — Search and update

```
1. podio_search_app({ app_id: 11111, query: "login page broken" })
   → find item 99999

2. podio_get_item({ item_id: 99999 })
   → read current field values

3. podio_update_item({ item_id: 99999, fields: { priority: 3 } })
   → escalate to Critical

4. podio_add_comment({ item_id: 99999, text: "Escalated to Critical — affecting all users" })
   → comment posted, followers notified
```

### Example 3 — Create and attach

```
1. podio_create_item({ app_id: 11111, fields: { title: "New deployment checklist" } })
   → item_id: 55555 created

2. podio_attach_file({ item_id: 55555, file_path: "/tmp/checklist.pdf" })
   → file uploaded and attached

3. podio_add_comment({ item_id: 55555, text: "Checklist attached for review" })
   → comment posted
```

---

## Contributing

1. **After modifying tools in `src/server.ts`:** Run `npm run docs` to regenerate the Tool Reference section in README.md.

2. **Pre-commit hook:** Run `npm run setup` after cloning to install the hook. It automatically runs `npm run docs` before commits that touch `src/` — keeping the README in sync without manual effort.

3. **TypeScript:** Strict mode is enabled. All runtime logs must go to stderr (never stdout — it corrupts the stdio JSON-RPC stream).

4. **Build:** Run `npm run build` to compile TypeScript before testing with an MCP client.

---

Built with the [Model Context Protocol](https://modelcontextprotocol.io)
