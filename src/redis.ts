import { Redis } from "ioredis";
import { REDIS_HOST } from "./config.js";

export const redis = new Redis({ host: REDIS_HOST, port: 6379 });

redis.on("error", (err) => {
  console.error("[Redis] Connection error:", err);
});
