import { Meilisearch } from "meilisearch";
import { MEILI_HOST, MEILI_API_KEY, INDEX_NAME } from "./config.js";

export interface GifDocument {
  id: string;           // file_unique_id — Primary Key
  file_id: string;
  tags: string[];
  emojis: string[];
  created_at: number;
}

const client = new Meilisearch({ host: MEILI_HOST, apiKey: MEILI_API_KEY });

export const gifIndex = client.index<GifDocument>(INDEX_NAME);

export async function setupMeilisearch(): Promise<void> {
  try {
    await client.createIndex(INDEX_NAME, { primaryKey: "id" });
  } catch {
    // Індекс вже існує
  }

  await gifIndex.updateSearchableAttributes(["tags", "emojis"]);
  await gifIndex.updateSortableAttributes(["created_at"]);
  await gifIndex.updateFilterableAttributes(["tags"]);

  console.log(`[Meilisearch] Index "${INDEX_NAME}" is ready`);
}

/** Merge if exists / Create if new. Повертає { isNew } */
export async function upsertGif(
  id: string,
  file_id: string,
  newTags: string[],
  newEmojis: string[]
): Promise<{ isNew: boolean }> {
  let existing: GifDocument | null = null;
  try {
    existing = await gifIndex.getDocument(id);
  } catch {}

  if (existing) {
    await gifIndex.updateDocuments([{
      ...existing,
      tags: Array.from(new Set([...existing.tags, ...newTags])),
      emojis: Array.from(new Set([...existing.emojis, ...newEmojis])),
    }]);
    return { isNew: false };
  }

  await gifIndex.addDocuments([{
    id,
    file_id,
    tags: Array.from(new Set(newTags)),
    emojis: Array.from(new Set(newEmojis)),
    created_at: Date.now(),
  }]);
  return { isNew: true };
}

/** Повністю замінює теги + емоджі (state: WAITING_TO_REPLACE_TAGS) */
export async function replaceTags(
  id: string,
  tags: string[],
  emojis: string[]
): Promise<boolean> {
  try {
    await gifIndex.getDocument(id);
  } catch {
    return false;
  }
  await gifIndex.updateDocuments([{
    id,
    tags: Array.from(new Set(tags)),
    emojis: Array.from(new Set(emojis)),
  }]);
  return true;
}

/** Зливає нові теги + емоджі з існуючими (state: WAITING_TO_APPEND_TAGS) */
export async function appendTags(
  id: string,
  newTags: string[],
  newEmojis: string[]
): Promise<boolean> {
  let existing: GifDocument;
  try {
    existing = await gifIndex.getDocument(id);
  } catch {
    return false;
  }
  await gifIndex.updateDocuments([{
    ...existing,
    tags: Array.from(new Set([...existing.tags, ...newTags])),
    emojis: Array.from(new Set([...existing.emojis, ...newEmojis])),
  }]);
  return true;
}

/** Команда /edit — повна заміна тегів (+ опційно емоджі) */
export async function editTags(
  id: string,
  tags: string[],
  emojis?: string[]
): Promise<boolean> {
  let existing: GifDocument;
  try {
    existing = await gifIndex.getDocument(id);
  } catch {
    return false;
  }
  await gifIndex.updateDocuments([{
    ...existing,
    tags: Array.from(new Set(tags)),
    emojis: emojis !== undefined ? Array.from(new Set(emojis)) : existing.emojis,
  }]);
  return true;
}

/** Переносить теги зі старої гіфки на нову, видаляє стару */
export async function replaceGif(
  oldId: string,
  newId: string,
  newFileId: string
): Promise<boolean> {
  let oldDoc: GifDocument;
  try {
    oldDoc = await gifIndex.getDocument(oldId);
  } catch {
    return false;
  }
  await gifIndex.addDocuments([{
    id: newId,
    file_id: newFileId,
    tags: oldDoc.tags,
    emojis: oldDoc.emojis,
    created_at: Date.now(),
  }]);
  await gifIndex.deleteDocument(oldId);
  return true;
}

/** Видаляє гіфку */
export async function deleteGif(id: string): Promise<boolean> {
  try {
    await gifIndex.getDocument(id);
  } catch {
    return false;
  }
  await gifIndex.deleteDocument(id);
  return true;
}

/** Пошук з підтримкою infinite scroll (offset) */
export async function searchGifs(
  query: string,
  limit = 50,
  offset = 0
): Promise<GifDocument[]> {
  const result = await gifIndex.search(query, {
    limit,
    offset,
    sort: ["created_at:desc"],
  });
  return result.hits;
}

/** Всі документи (для бекапу) */
export async function getAllGifs(): Promise<GifDocument[]> {
  const all: GifDocument[] = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const result = await gifIndex.getDocuments({ limit: batchSize, offset });
    all.push(...result.results);
    if (result.results.length < batchSize) break;
    offset += batchSize;
  }
  return all;
}

/** Фасетний пошук тегів для /tags каталогу */
export async function getTagFacets(): Promise<Record<string, number>> {
  const result = await gifIndex.search("", { facets: ["tags"], limit: 0 });
  return (result.facetDistribution?.["tags"] ?? {}) as Record<string, number>;
}