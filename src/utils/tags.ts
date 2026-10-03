import emojiRegex from "emoji-regex";

const TAG_REGEX = /#[\p{L}\p{M}\p{N}_]+/gu;

export function extractTags(text: string | undefined | null): string[] {
  if (!text) return [];
  return [...new Set((text.normalize("NFC").match(TAG_REGEX) ?? []).map(tag => tag.toLowerCase()))];
}

/** Reject partially parsed hashtags instead of silently saving a truncated label. */
export function hasInvalidTags(text: string | undefined | null): boolean {
  if (!text) return false;
  // The # keycap is an emoji, not a malformed hashtag.
  const withoutEmojis = text.normalize("NFC").replace(emojiRegex(), "");
  return (withoutEmojis.match(/#[^\s#]+|#(?=\s|$)/gu) ?? []).some(part => !/^#[\p{L}\p{M}\p{N}_]+$/u.test(part));
}

export function extractEmojis(text: string | undefined | null): string[] {
  if (!text) return [];
  return [...new Set(text.match(emojiRegex()) ?? [])];
}

export function labelsWithinLimit(tags: string[], emojis: string[]): boolean {
  return tags.length + emojis.length <= 32 && tags.every(tag => Array.from(tag).length <= 64) && Array.from([...tags, ...emojis].join(" ")).length <= 700;
}
