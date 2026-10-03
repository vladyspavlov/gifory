import "dotenv/config";

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Environment variable ${name} is required`);
  return val;
}

export const BOT_TOKEN = required("BOT_TOKEN");
export const MEILI_HOST = process.env.MEILI_HOST ?? "http://meilisearch:7700";
export const MEILI_API_KEY = process.env.MEILI_MASTER_KEY ?? process.env.MEILI_API_KEY ?? "";
export const REDIS_HOST = process.env.REDIS_HOST ?? "redis";

// Full recovery archives contain all tenant data and must go to a private user ID.
const ownerId = process.env.SUPER_ADMIN_ID ? Number(process.env.SUPER_ADMIN_ID) : null;
if (ownerId !== null && (!Number.isSafeInteger(ownerId) || ownerId <= 0)) {
  throw new Error("SUPER_ADMIN_ID must be a positive Telegram user ID");
}
export const SUPER_ADMIN_ID = ownerId;

export const INDEX_NAME = "gifs";
