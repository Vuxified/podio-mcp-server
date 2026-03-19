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
_Run `npm run docs` to generate this section._
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
