import { Meilisearch } from "meilisearch";
import { MEILI_HOST, MEILI_API_KEY, INDEX_NAME } from "./config.js";
import { trackGif } from "./analytics.js";

export interface GifDocument {
  id: string;              // `${scopeId}_${fileUniqueId}` — Primary Key
  file_unique_id: string;  // Telegram file_unique_id (for dedup within scope)
  file_id: string;
  scope_id: string;
  tags: string[];
  emojis: string[];
  created_at: number;
  expired?: boolean;       // true when file_id is confirmed unreachable; excluded from search
}

const client = new Meilisearch({ host: MEILI_HOST, apiKey: MEILI_API_KEY });

export const gifIndex = client.index<GifDocument>(INDEX_NAME);

export async function setupMeilisearch(): Promise<void> {
  try {
    await client.createIndex(INDEX_NAME, { primaryKey: "id" });
  } catch {
    // Index already exists
  }

  await gifIndex.updateSearchableAttributes(["tags", "emojis"]);
  await gifIndex.updateSortableAttributes(["created_at"]);
  await gifIndex.updateFilterableAttributes(["tags", "scope_id", "expired"]);
  await gifIndex.updateFaceting({ maxValuesPerFacet: 1000, sortFacetValuesBy: { "*": "count" } });

  console.log(`[Meilisearch] Index "${INDEX_NAME}" is ready`);
}

function docId(scopeId: string, fileUniqueId: string): string {
  return `${scopeId}_${fileUniqueId}`;
}

/** Merge if exists in scope / Create if new. Returns { isNew } */
export async function upsertGif(
  fileUniqueId: string,
  file_id: string,
  newTags: string[],
  newEmojis: string[],
  scopeId: string
): Promise<{ isNew: boolean }> {
  const id = docId(scopeId, fileUniqueId);
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
    file_unique_id: fileUniqueId,
    file_id,
    scope_id: scopeId,
    tags: Array.from(new Set(newTags)),
    emojis: Array.from(new Set(newEmojis)),
    created_at: Date.now(),
  }]);
  trackGif(id).catch(() => {});
  return { isNew: true };
}

/** Fully replaces tags + emojis (WAITING_TO_REPLACE_TAGS) */
export async function replaceTags(
  fileUniqueId: string,
  tags: string[],
  emojis: string[],
  scopeId: string
): Promise<boolean> {
  const id = docId(scopeId, fileUniqueId);
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

/** Merges new tags + emojis with existing (WAITING_TO_APPEND_TAGS) */
export async function appendTags(
  fileUniqueId: string,
  newTags: string[],
  newEmojis: string[],
  scopeId: string
): Promise<GifDocument | null> {
  const id = docId(scopeId, fileUniqueId);
  let existing: GifDocument;
  try {
    existing = await gifIndex.getDocument(id);
  } catch {
    return null;
  }
  const updated: GifDocument = {
    ...existing,
    tags: Array.from(new Set([...existing.tags, ...newTags])),
    emojis: Array.from(new Set([...existing.emojis, ...newEmojis])),
  };
  await gifIndex.updateDocuments([updated]);
  return updated;
}

/** /edit command — full tag replacement */
export async function editTags(
  fileUniqueId: string,
  tags: string[],
  emojis: string[],
  scopeId: string
): Promise<boolean> {
  const id = docId(scopeId, fileUniqueId);
  let existing: GifDocument;
  try {
    existing = await gifIndex.getDocument(id);
  } catch {
    return false;
  }
  await gifIndex.updateDocuments([{
    ...existing,
    tags: Array.from(new Set(tags)),
    emojis: Array.from(new Set(emojis)),
  }]);
  return true;
}

/** Moves tags from old GIF to new, deletes old */
export async function replaceGif(
  oldFileUniqueId: string,
  newFileUniqueId: string,
  newFileId: string,
  scopeId: string
): Promise<boolean> {
  const oldId = docId(scopeId, oldFileUniqueId);
  let oldDoc: GifDocument;
  try {
    oldDoc = await gifIndex.getDocument(oldId);
  } catch {
    return false;
  }
  await gifIndex.addDocuments([{
    id: docId(scopeId, newFileUniqueId),
    file_unique_id: newFileUniqueId,
    file_id: newFileId,
    scope_id: scopeId,
    tags: oldDoc.tags,
    emojis: oldDoc.emojis,
    created_at: Date.now(),
  }]);
  await gifIndex.deleteDocument(oldId);
  return true;
}

/** Deletes a GIF from the scope */
export async function deleteGif(
  fileUniqueId: string,
  scopeId: string
): Promise<boolean> {
  const id = docId(scopeId, fileUniqueId);
  try {
    await gifIndex.getDocument(id);
  } catch {
    return false;
  }
  await gifIndex.deleteDocument(id);
  return true;
}

/** Search across one or more scopes (merged inline search) */
export async function searchGifs(
  query: string,
  scopeIds: string[],
  limit = 50,
  offset = 0
): Promise<GifDocument[]> {
  if (scopeIds.length === 0) return [];
  const scopeFilter = scopeIds.map((id) => `scope_id = "${id}"`).join(" OR ");
  const filter = `(${scopeFilter}) AND expired != true`;
  const result = await gifIndex.search(query, {
    filter,
    limit,
    offset,
    sort: ["created_at:desc"],
  });
  return result.hits;
}

/** Mark a GIF's file_id as unreachable; excludes it from search but preserves tag metadata */
export async function markGifExpired(docId: string): Promise<void> {
  await gifIndex.updateDocuments([{ id: docId, expired: true } as Partial<GifDocument> & { id: string }]);
}

/** Update file_id for an existing GIF and clear any expired flag (called when GIF is re-sent) */
export async function refreshGifFileId(
  fileUniqueId: string,
  newFileId: string,
  scopeId: string
): Promise<void> {
  const id = docId(scopeId, fileUniqueId);
  try {
    await gifIndex.getDocument(id);
    await gifIndex.updateDocuments([{ id, file_id: newFileId, expired: false } as Partial<GifDocument> & { id: string }]);
  } catch {}
}

/** All docs in a scope (for backup) */
export async function getAllGifs(scopeId: string): Promise<GifDocument[]> {
  const all: GifDocument[] = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const result = await gifIndex.getDocuments({
      filter: `scope_id = "${scopeId}"`,
      limit: batchSize,
      offset,
    });
    all.push(...result.results);
    if (result.results.length < batchSize) break;
    offset += batchSize;
  }
  return all;
}

/** Tag facets for the /tags catalog (scope-specific) */
export async function getTagFacets(scopeId: string): Promise<Record<string, number>> {
  const result = await gifIndex.search("", {
    filter: `scope_id = "${scopeId}" AND expired != true`,
    facets: ["tags"],
    limit: 0,
  });
  return (result.facetDistribution?.["tags"] ?? {}) as Record<string, number>;
}

/** Look up a GIF by file_unique_id within a scope */
export async function getGifInScope(
  fileUniqueId: string,
  scopeId: string
): Promise<GifDocument | null> {
  try {
    return await gifIndex.getDocument(docId(scopeId, fileUniqueId));
  } catch {
    return null;
  }
}
