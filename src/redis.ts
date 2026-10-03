import { Redis } from "ioredis";
import { REDIS_HOST } from "./config.js";

// ioredis 6 defaults to RESP3; retain the response shapes used by our callers.
export const redis = new Redis({ host: REDIS_HOST, port: 6379, protocol: 2, lazyConnect: true });

redis.on("error", (err) => {
  console.error("[Redis] Connection error:", err);
});
