import "dotenv/config";

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Environment variable ${name} is required`);
  return val;
}

function parseIds(envKey: string): number[] {
  return (process.env[envKey] ?? "")
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((id) => !isNaN(id) && id > 0);
}

export const BOT_TOKEN = required("BOT_TOKEN");
export const MEILI_HOST = process.env.MEILI_HOST ?? "http://meilisearch:7700";
export const MEILI_API_KEY = process.env.MEILI_API_KEY ?? "";
export const REDIS_HOST = process.env.REDIS_HOST ?? "redis";

export const ADMIN_IDS: number[] = parseIds("ADMIN_IDS");
// export const USER_IDS: number[] = parseIds("USER_IDS");

// Перший адмін — отримувач авто-бекапів
export const ADMIN_USER_ID = ADMIN_IDS[0];

export const INDEX_NAME = "gifs";
