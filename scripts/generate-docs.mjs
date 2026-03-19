#!/usr/bin/env node
// scripts/generate-docs.mjs
// Generates the Tool Reference section in README.md from live source code.
// Usage: node scripts/generate-docs.mjs  (or: npm run docs)

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Set dummy env vars before import to prevent dotenv/config errors from transitive imports.
// ESM hoists static imports, so we use dynamic import AFTER setting these.
process.env.PODIO_CLIENT_ID ??= 'docs-gen';
process.env.PODIO_CLIENT_SECRET ??= 'docs-gen';
process.env.PODIO_TOKEN_PATH ??= '.podio-tokens.json';

const { createServer } = await import('../dist/server.js');

// ---------------------------------------------------------------------------
// Category grouping
// ---------------------------------------------------------------------------
const CATEGORY_MAP = {
  podio_health_check: 'Utility',
  podio_list_organizations: 'Organizations',
  podio_list_spaces: 'Organizations',
  podio_list_apps: 'Apps',
  podio_get_app: 'Apps',
  podio_create_item: 'Items',
  podio_get_item: 'Items',
  podio_update_item: 'Items',
  podio_delete_item: 'Items',
  podio_filter_items: 'Items',
  podio_filter_items_by_view: 'Items',
  podio_list_views: 'Items',
  podio_add_comment: 'Comments',
  podio_get_comments: 'Comments',
  podio_create_webhook: 'Webhooks',
  podio_list_webhooks: 'Webhooks',
  podio_delete_webhook: 'Webhooks',
  podio_attach_file: 'Files',
  podio_search_global: 'Search',
  podio_search_app: 'Search',
};

const CATEGORY_ORDER = [
  'Utility',
  'Organizations',
  'Apps',
  'Items',
  'Comments',
  'Webhooks',
  'Files',
  'Search',
];

// ---------------------------------------------------------------------------
// Tool examples and truncated response shapes (hand-authored once)
// ---------------------------------------------------------------------------
const TOOL_EXAMPLES = {
  podio_health_check: {
    example: `{}`,
    response: `{ "data": { "status": "ok", "user": { "name": "Jane Smith", "email": "jane@acme.com" } }, "_meta": { "rate_limit_remaining": 499, "rate_limit_total": 500 } }`,
  },
  podio_list_organizations: {
    example: `{}`,
    response: `{ "data": [{ "org_id": 12345, "name": "Acme Corp", "url": "https://podio.com/acmecorp", ... }], "_meta": { ... } }`,
  },
  podio_list_spaces: {
    example: `{ "org_id": 12345 }`,
    response: `{ "data": [{ "space_id": 67890, "name": "Engineering", "org_id": 12345, ... }], "_meta": { ... } }`,
  },
  podio_list_apps: {
    example: `{ "space_id": 67890 }`,
    response: `{ "data": [{ "app_id": 11111, "config": { "name": "Bug Tracker", "item_name": "Bug" }, ... }], "_meta": { ... } }`,
  },
  podio_get_app: {
    example: `{ "app_id": 11111 }`,
    response: `{ "data": { "app_id": 11111, "config": { "name": "Bug Tracker" }, "fields": [{ "field_id": 1, "type": "text", "label": "Title" }, ...] }, "_meta": { ... } }`,
  },
  podio_create_item: {
    example: `{ "app_id": 11111, "fields": { "title": "Fix login page" } }`,
    response: `{ "data": { "item_id": 99999, "title": "Fix login page" }, "_meta": { ... } }`,
  },
  podio_get_item: {
    example: `{ "item_id": 99999 }`,
    response: `{ "data": { "item_id": 99999, "title": "Fix login page", "fields": [{ "field_id": 1, "type": "text", "label": "Title", "values": [{ "value": "Fix login page" }] }, ...] }, "_meta": { ... } }`,
  },
  podio_update_item: {
    example: `{ "item_id": 99999, "fields": { "priority": 1 } }`,
    response: `{ "data": { "item_id": 99999, "title": "Fix login page" }, "_meta": { ... } }`,
  },
  podio_delete_item: {
    example: `{ "item_id": 99999 }`,
    response: `{ "data": { "deleted": true }, "_meta": { ... } }`,
  },
  podio_filter_items: {
    example: `{ "app_id": 11111, "filters": { "priority": [1] }, "limit": 5 }`,
    response: `{ "data": { "total": 42, "filtered": 3, "items": [{ "item_id": 99999, "title": "Fix login page", ... }, ...] }, "_meta": { ... } }`,
  },
  podio_filter_items_by_view: {
    example: `{ "app_id": 11111, "view_id": 5555, "limit": 10 }`,
    response: `{ "data": { "total": 20, "filtered": 20, "items": [{ "item_id": 99999, "title": "Fix login page", ... }, ...] }, "_meta": { ... } }`,
  },
  podio_list_views: {
    example: `{ "app_id": 11111 }`,
    response: `{ "data": [{ "view_id": 5555, "name": "Critical Bugs", "type": "standard", ... }], "_meta": { ... } }`,
  },
  podio_add_comment: {
    example: `{ "item_id": 99999, "text": "Escalated to Critical" }`,
    response: `{ "data": { "comment_id": 77777 }, "_meta": { ... } }`,
  },
  podio_get_comments: {
    example: `{ "item_id": 99999 }`,
    response: `{ "data": [{ "comment_id": 77777, "value": "Escalated to Critical", "created_by": { "name": "Jane Smith" }, ... }], "_meta": { ... } }`,
  },
  podio_create_webhook: {
    example: `{ "ref_type": "app", "ref_id": 11111, "url": "https://hooks.example.com/podio", "type": "item.create" }`,
    response: `{ "data": { "hook_id": 3333, "status": "inactive", "type": "item.create", "url": "https://hooks.example.com/podio" }, "_meta": { ... } }`,
  },
  podio_list_webhooks: {
    example: `{ "ref_type": "app", "ref_id": 11111 }`,
    response: `{ "data": [{ "hook_id": 3333, "type": "item.create", "url": "https://hooks.example.com/podio", "status": "active", ... }], "_meta": { ... } }`,
  },
  podio_delete_webhook: {
    example: `{ "hook_id": 3333 }`,
    response: `{ "data": { "deleted": true }, "_meta": { ... } }`,
  },
  podio_attach_file: {
    example: `{ "item_id": 99999, "file_path": "/tmp/report.pdf" }`,
    response: `{ "data": { "file_id": 44444, "name": "report.pdf", "size": 102400 }, "_meta": { ... } }`,
  },
  podio_search_global: {
    example: `{ "query": "login page", "limit": 5 }`,
    response: `{ "data": [{ "type": "item", "id": 99999, "title": "Fix login page", "app": { "name": "Bug Tracker" }, ... }], "_meta": { ... } }`,
  },
  podio_search_app: {
    example: `{ "app_id": 11111, "query": "login page", "limit": 5 }`,
    response: `{ "data": [{ "type": "item", "id": 99999, "title": "Fix login page", ... }], "_meta": { ... } }`,
  },
};

// ---------------------------------------------------------------------------
// Helpers: field type resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a Zod field def to a human-readable type string.
 * Uses the Zod v4 runtime structure: field.type and field.def.
 */
function resolveFieldType(fieldDef) {
  const type = fieldDef.type;

  if (type === 'optional') {
    const innerType = fieldDef.def.innerType.type;
    return resolveInnerType(fieldDef.def.innerType);
  }

  return resolveInnerType(fieldDef);
}

function resolveInnerType(fieldDef) {
  const type = fieldDef.type;

  switch (type) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'record':
      return 'object';
    case 'array': {
      const elementType = fieldDef.def?.element?.type ?? 'unknown';
      return `${elementType}[]`;
    }
    case 'enum': {
      const entries = fieldDef.def?.entries ?? {};
      const values = Object.values(entries);
      return values.map((v) => `"${v}"`).join(' | ');
    }
    default:
      return type ?? 'unknown';
  }
}

function isRequired(fieldDef) {
  return fieldDef.type !== 'optional';
}

// ---------------------------------------------------------------------------
// Markdown generation per tool
// ---------------------------------------------------------------------------

function generateToolSection(name, tool) {
  const lines = [];

  lines.push(`### \`${name}\``);
  lines.push('');
  lines.push(`**${tool.title}**`);
  lines.push('');
  lines.push(tool.description);
  lines.push('');

  const shape = tool.inputSchema.def?.shape ?? {};
  const fields = Object.entries(shape);

  if (fields.length === 0) {
    lines.push('_No parameters required._');
  } else {
    lines.push('| Parameter | Type | Required | Description |');
    lines.push('|-----------|------|----------|-------------|');
    for (const [fieldName, fieldDef] of fields) {
      const type = resolveFieldType(fieldDef);
      const required = isRequired(fieldDef) ? 'Yes' : 'No';
      const description = fieldDef.description ?? '';
      lines.push(`| \`${fieldName}\` | \`${type}\` | ${required} | ${description} |`);
    }
  }

  lines.push('');

  const ex = TOOL_EXAMPLES[name];
  if (ex) {
    lines.push('**Example:**');
    lines.push('```json');
    lines.push('// Request');
    lines.push(ex.example);
    lines.push('');
    lines.push('// Response (truncated)');
    lines.push(ex.response);
    lines.push('```');
  } else {
    lines.push('_No example available yet._');
  }

  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Extract tool blocks from existing sentinel content for diffing
// ---------------------------------------------------------------------------

function extractToolBlocks(content) {
  const blocks = {};
  // Split on ### ` to find per-tool sections
  const parts = content.split(/\n(?=### `)/);
  for (const part of parts) {
    const match = part.match(/^### `([^`]+)`/);
    if (match) {
      blocks[match[1]] = part.trim();
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const server = createServer();
const registeredTools = server._registeredTools;

if (!registeredTools || typeof registeredTools !== 'object') {
  console.error('[docs] ERROR: server._registeredTools is missing or not an object');
  process.exit(1);
}

// Read README.md
const readmePath = join(ROOT, 'README.md');
let readmeContent;
try {
  readmeContent = readFileSync(readmePath, 'utf8');
} catch (err) {
  console.error(`[docs] ERROR: Could not read README.md: ${err.message}`);
  process.exit(1);
}

const START_SENTINEL = '<!-- GENERATED:TOOL-REFERENCE:START -->';
const END_SENTINEL = '<!-- GENERATED:TOOL-REFERENCE:END -->';

const startIdx = readmeContent.indexOf(START_SENTINEL);
const endIdx = readmeContent.indexOf(END_SENTINEL);

if (startIdx === -1 || endIdx === -1) {
  console.error('[docs] ERROR: Sentinel comments not found in README.md');
  process.exit(1);
}

// Extract existing tool blocks for diffing
const existingContent = readmeContent.slice(startIdx + START_SENTINEL.length, endIdx);
const oldBlocks = extractToolBlocks(existingContent);

// Group tools by category
const byCategory = {};
for (const [name, tool] of Object.entries(registeredTools)) {
  const category = CATEGORY_MAP[name] ?? 'Other';
  if (!byCategory[category]) byCategory[category] = [];
  byCategory[category].push([name, tool]);
}

// Generate new Markdown
const categoryMarkdown = [];
for (const category of CATEGORY_ORDER) {
  const tools = byCategory[category];
  if (!tools || tools.length === 0) continue;

  categoryMarkdown.push(`## ${category}`);
  categoryMarkdown.push('');
  for (const [name, tool] of tools) {
    categoryMarkdown.push(generateToolSection(name, tool));
  }
}

// Handle 'Other' category (defensive)
if (byCategory['Other'] && byCategory['Other'].length > 0) {
  categoryMarkdown.push('## Other');
  categoryMarkdown.push('');
  for (const [name, tool] of byCategory['Other']) {
    categoryMarkdown.push(generateToolSection(name, tool));
  }
}

const newContent = '\n' + categoryMarkdown.join('\n') + '\n';

// Extract new tool blocks for diffing
const newBlocks = extractToolBlocks(newContent);

// Compute diff
const allToolNames = new Set([...Object.keys(oldBlocks), ...Object.keys(newBlocks)]);
const changed = [];
let anyChange = false;

for (const toolName of allToolNames) {
  if (!(toolName in oldBlocks) && toolName in newBlocks) {
    changed.push(`${toolName} (new)`);
    anyChange = true;
  } else if (toolName in oldBlocks && !(toolName in newBlocks)) {
    changed.push(`${toolName} (removed)`);
    anyChange = true;
  } else if (oldBlocks[toolName] !== newBlocks[toolName]) {
    changed.push(`${toolName} (updated)`);
    anyChange = true;
  }
}

// Count totals
const toolCount = Object.keys(newBlocks).length;
const categoryCount = CATEGORY_ORDER.filter((c) => byCategory[c] && byCategory[c].length > 0).length
  + (byCategory['Other'] ? 1 : 0);

// Write updated README.md
const updatedReadme =
  readmeContent.slice(0, startIdx + START_SENTINEL.length) +
  newContent +
  readmeContent.slice(endIdx);

writeFileSync(readmePath, updatedReadme, 'utf8');

// Output change summary
if (anyChange) {
  console.log(`[docs] Changed: ${changed.join(', ')}`);
} else {
  console.log(`[docs] No changes detected (${toolCount} tools in ${categoryCount} categories)`);
}
console.log(`[docs] README.md updated (${toolCount} tools in ${categoryCount} categories)`);
