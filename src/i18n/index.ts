import { redis } from "../redis.js";
import { en, Messages } from "./en.js";
import { uk } from "./uk.js";

export type { Messages };
export type Lang = "en" | "uk";
export type TFunction = (key: keyof Messages, params?: Record<string, string | number>) => string;

const locales: Record<Lang, Messages> = { en, uk };

export function t(lang: Lang, key: keyof Messages, params?: Record<string, string | number>): string {
  let str: string = locales[lang][key] ?? locales.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

export async function getUserLang(userId: number, telegramLangCode?: string): Promise<Lang> {
  const stored = await redis.get(`user_lang:${userId}`);
  if (stored === "en" || stored === "uk") return stored;
  if (telegramLangCode?.startsWith("uk")) return "uk";
  return "en";
}

export async function setUserLang(userId: number, lang: Lang): Promise<void> {
  await redis.set(`user_lang:${userId}`, lang);
}
