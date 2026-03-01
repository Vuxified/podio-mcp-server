import { AxiosError } from "axios";

export interface McpErrorResponse {
  [key: string]: unknown;
  content: [{ type: "text"; text: string }];
  isError: true;
}

/**
 * Convert any Podio API error into a structured MCP tool error response.
 *
 * NEVER throw exceptions from MCP tool handlers — JSON-RPC protocol errors
 * terminate the entire session. Always return { isError: true } instead.
 */
export function toMcpError(err: unknown): McpErrorResponse {
  let text: string;

  if (err instanceof AxiosError) {
    const status = err.response?.status;
    const podioMessage =
      err.response?.data?.error_description ??
      err.response?.data?.error ??
      err.message;

    if (status === 420) {
      // Podio uses 420 for rate limiting — NOT 429 (HTTP standard).
      text = `Podio rate limit exceeded (HTTP 420). Wait approximately 60 seconds before retrying. The server tracks remaining calls via X-Rate-Limit-Remaining headers.`;
    } else if (status === 401) {
      text = `Podio authentication failed (401). The access token is invalid or expired. The server will attempt to refresh on the next call. If this persists, check PODIO_USERNAME and PODIO_PASSWORD in .env.`;
    } else if (status === 403) {
      text = `Podio authorization denied (403). The authenticated user lacks permission for this operation.`;
    } else if (status === 404) {
      text = `Podio resource not found (404). Verify the ID is correct and the resource exists. Details: ${podioMessage}`;
    } else if (status === 500) {
      text = `Podio server error (500). This is a Podio-side issue. Retry once after 10 seconds. Details: ${podioMessage}`;
    } else if (status != null) {
      text = `Podio API error (HTTP ${status}): ${podioMessage}`;
    } else {
      text = `Network error connecting to Podio: ${err.message}. Check your internet connection and that api.podio.com is reachable.`;
    }
  } else if (err instanceof Error) {
    text = `Internal server error: ${err.message}`;
  } else {
    text = `Unknown error: ${String(err)}`;
  }

  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}
