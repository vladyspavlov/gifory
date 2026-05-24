import emojiRegex from "emoji-regex";

const TAG_REGEX = /#[\wa-zA-Zа-яА-ЯіїєґІЇЄҐ]+/g;

export function extractTags(text: string | undefined | null): string[] {
  if (!text) return [];
  const matches = text.match(TAG_REGEX);
  return matches ? matches.map((tag) => tag.toLowerCase()) : [];
}

export function extractEmojis(text: string | undefined | null): string[] {
  if (!text) return [];
  const regex = emojiRegex();
  const matches = text.match(regex);
  return matches ? Array.from(new Set(matches)) : [];
}