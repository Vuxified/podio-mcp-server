/**
 * Stderr-only logger. NEVER use console.log() — stdout is the JSON-RPC channel.
 * Any non-JSON-RPC bytes on stdout corrupt the MCP protocol and silently break
 * the MCP client connection with no obvious error message.
 */
export const log = {
  info: (...args: unknown[]): void => {
    process.stderr.write(`[INFO] ${args.map(String).join(" ")}\n`);
  },
  warn: (...args: unknown[]): void => {
    process.stderr.write(`[WARN] ${args.map(String).join(" ")}\n`);
  },
  error: (...args: unknown[]): void => {
    process.stderr.write(`[ERROR] ${args.map(String).join(" ")}\n`);
  },
};
