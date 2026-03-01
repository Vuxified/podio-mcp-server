import axios from "axios";
import { tokenManager } from "../auth/token-manager.js";
import { log } from "../utils/logger.js";

export interface RateLimitInfo {
  limit: number;
  remaining: number;
}

export let lastRateLimit: RateLimitInfo = { limit: 1000, remaining: 1000 };

export const podioApi = axios.create({
  baseURL: "https://api.podio.com",
  headers: { "Content-Type": "application/json" },
});

podioApi.interceptors.request.use(async (config) => {
  const token = await tokenManager.getValidToken();
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

podioApi.interceptors.response.use(
  (response) => {
    const limit = response.headers["x-rate-limit-limit"];
    const remaining = response.headers["x-rate-limit-remaining"];
    if (limit != null && remaining != null) {
      lastRateLimit = {
        limit: Number(limit),
        remaining: Number(remaining),
      };
      log.info(`Rate limit: ${lastRateLimit.remaining}/${lastRateLimit.limit} remaining`);
    }
    return response;
  },
  (error) => {
    const hdrs = error.response?.headers;
    if (hdrs?.["x-rate-limit-limit"]) {
      lastRateLimit = {
        limit: Number(hdrs["x-rate-limit-limit"]),
        remaining: Number(hdrs["x-rate-limit-remaining"] ?? 0),
      };
    }
    return Promise.reject(error);
  }
);
