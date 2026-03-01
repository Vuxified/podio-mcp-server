import "dotenv/config";
import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { log } from "../utils/logger.js";

interface TokenStore {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

const PODIO_TOKEN_URL = "https://api.podio.com/oauth/token/v2";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class TokenManager {
  private store: TokenStore | null = null;

  private get tokenPath(): string {
    return path.resolve(process.env.PODIO_TOKEN_PATH ?? ".podio-tokens.json");
  }

  async getValidToken(): Promise<string> {
    if (!this.store) {
      await this.loadFromDisk();
    }

    if (this.store && Date.now() < this.store.expires_at - REFRESH_BUFFER_MS) {
      return this.store.access_token;
    }

    if (this.store?.refresh_token) {
      log.info("Access token expiring soon — refreshing via refresh_token");
      await this.refresh();
    } else {
      log.info("No token on disk — acquiring via password grant");
      await this.acquireViaPassword();
    }

    return this.store!.access_token;
  }

  private async acquireViaPassword(): Promise<void> {
    const resp = await axios.post<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>(PODIO_TOKEN_URL, {
      grant_type: "password",
      username: process.env.PODIO_USERNAME,
      password: process.env.PODIO_PASSWORD,
      client_id: process.env.PODIO_CLIENT_ID,
      client_secret: process.env.PODIO_CLIENT_SECRET,
      redirect_uri: process.env.PODIO_REDIRECT_URI,
    });
    await this.saveStore(resp.data);
    log.info("Token acquired via password grant");
  }

  private async refresh(): Promise<void> {
    const resp = await axios.post<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>(PODIO_TOKEN_URL, {
      grant_type: "refresh_token",
      client_id: process.env.PODIO_CLIENT_ID,
      client_secret: process.env.PODIO_CLIENT_SECRET,
      refresh_token: this.store!.refresh_token,
    });
    await this.saveStore(resp.data);
    log.info("Token refreshed via refresh_token");
  }

  private async saveStore(data: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }): Promise<void> {
    this.store = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };
    await fs.writeFile(this.tokenPath, JSON.stringify(this.store, null, 2), {
      mode: 0o600,
    });
    log.info(`Tokens persisted to ${this.tokenPath}`);
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(this.tokenPath, "utf-8");
      this.store = JSON.parse(raw) as TokenStore;
      log.info(`Tokens loaded from ${this.tokenPath}`);
    } catch {
      this.store = null;
    }
  }
}

export const tokenManager = new TokenManager();
