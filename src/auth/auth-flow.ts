import "dotenv/config";
import http from "node:http";
import { randomUUID } from "node:crypto";
import open from "open";
import axios from "axios";
import fs from "node:fs/promises";
import path from "node:path";

const PODIO_AUTHORIZE_URL = "https://podio.com/oauth/authorize";
const PODIO_TOKEN_URL = "https://api.podio.com/oauth/token/v2";
const CALLBACK_PORT = 8888;
const CALLBACK_PATH = "/callback";
const TIMEOUT_MS = 120_000; // 2 minutes for user to complete auth

interface TokenStore {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

/** Spin up a temp HTTP server, return the auth code when callback arrives. */
function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      // User denied
      if (url.searchParams.has("error")) {
        const desc =
          url.searchParams.get("error_description") ??
          url.searchParams.get("error");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h2>Authorization denied.</h2><p>You can close this tab.</p></body></html>"
        );
        server.close();
        reject(new Error(`Authorization denied: ${desc}`));
        return;
      }

      // Validate state (CSRF)
      const returnedState = url.searchParams.get("state");
      if (returnedState !== expectedState) {
        res.writeHead(400);
        res.end("State mismatch — possible CSRF attack. Aborting.");
        server.close();
        reject(new Error("State parameter mismatch — authorization aborted."));
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400);
        res.end("Missing code parameter");
        server.close();
        reject(new Error("No authorization code in callback"));
        return;
      }

      // Success — send a nice response before closing
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body><h2>Authorization successful!</h2><p>You can close this tab and return to the terminal.</p></body></html>"
      );
      server.close();
      resolve(code);
    });

    // Port already in use
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${CALLBACK_PORT} is already in use. Stop whatever is using it and try again.`
          )
        );
      } else {
        reject(err);
      }
    });

    server.listen(CALLBACK_PORT, "127.0.0.1");
  });
}

async function run(): Promise<void> {
  const clientId = process.env.PODIO_CLIENT_ID;
  const clientSecret = process.env.PODIO_CLIENT_SECRET;
  const redirectUri =
    process.env.PODIO_REDIRECT_URI ??
    `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
  const tokenPath = path.resolve(
    process.env.PODIO_TOKEN_PATH ?? ".podio-tokens.json"
  );

  if (!clientId || !clientSecret) {
    throw new Error("PODIO_CLIENT_ID and PODIO_CLIENT_SECRET must be set in .env");
  }

  const state = randomUUID();

  const authorizeUrl =
    `${PODIO_AUTHORIZE_URL}` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&state=${encodeURIComponent(state)}`;

  process.stderr.write(`Opening browser for Podio authorization...\n`);
  process.stderr.write(
    `If the browser does not open, navigate to:\n${authorizeUrl}\n`
  );

  // Start server BEFORE opening browser to avoid race condition
  const callbackPromise = waitForCallback(state);

  // Open browser
  await open(authorizeUrl);

  // Race: callback vs timeout
  const code = await Promise.race([
    callbackPromise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Authorization timed out after 2 minutes")),
        TIMEOUT_MS
      )
    ),
  ]);

  process.stderr.write("Authorization code received. Exchanging for tokens...\n");

  // Exchange code for tokens
  const resp = await axios.post<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>(PODIO_TOKEN_URL, {
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const store: TokenStore = {
    access_token: resp.data.access_token,
    refresh_token: resp.data.refresh_token,
    expires_at: Date.now() + resp.data.expires_in * 1000,
  };

  await fs.writeFile(tokenPath, JSON.stringify(store, null, 2), {
    mode: 0o600,
  });
  process.stderr.write(`Tokens saved to ${tokenPath}\n`);
  process.stderr.write(
    "Authentication complete. You can now start the MCP server.\n"
  );
}

run().catch((err: Error) => {
  process.stderr.write(`[ERROR] ${err.message}\n`);
  process.exit(1);
});
