import { Meilisearch, MeilisearchApiError, type EnqueuedTask } from "meilisearch";
import { MEILI_HOST, MEILI_API_KEY, INDEX_NAME } from "./config.js";
import { trackGif } from "./analytics.js";

export interface GifDocument {
  id: string;
  file_unique_id: string;
  file_id: string;
  scope_id: string;
  tags: string[];
  emojis: string[];
  created_at: number;
  expired?: boolean;
}

const client = new Meilisearch({ host: MEILI_HOST, apiKey: MEILI_API_KEY, timeout: 15_000 });
export const gifIndex = client.index<GifDocument>(INDEX_NAME);
const visibleFilter = "(expired NOT EXISTS OR expired = false)";
const scopeFilter = (id: string) => `scope_id = ${JSON.stringify(id)}`;

/** A submitted task is not a successful mutation until indexing finishes. */
export async function waitForWrite(task: EnqueuedTask): Promise<void> {
  const result = await client.tasks.waitForTask(task, { timeout: 30_000, interval: 100 });
  if (result.status !== "succeeded") {
    throw new Error(`Meilisearch task ${result.uid} ${result.status}: ${result.error?.code ?? "unknown"}`);
  }
}

export async function setupMeilisearch(): Promise<void> {
  try {
    await client.getRawIndex(INDEX_NAME);
  } catch (error) {
    if (!(error instanceof MeilisearchApiError) || error.cause?.code !== "index_not_found") throw error;
    await waitForWrite(await client.createIndex(INDEX_NAME, { primaryKey: "id" }));
  }
  await waitForWrite(await gifIndex.updateSettings({
    searchableAttributes: ["tags", "emojis"],
    sortableAttributes: ["created_at"],
    filterableAttributes: ["tags", "scope_id", "expired"],
    faceting: { maxValuesPerFacet: 1000, sortFacetValuesBy: { "*": "count" } },
  }));
  console.log(`[Meilisearch] Index "${INDEX_NAME}" is ready`);
}

function docId(scopeId: string, fileUniqueId: string): string {
  return `${scopeId}_${fileUniqueId}`;
}

// Serialize read/modify/write operations within the single bot process.
const writes = new Map<string, Promise<unknown>>();
async function inScope<T>(scopeId: string, operation: () => Promise<T>): Promise<T> {
  const previous = writes.get(scopeId) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  writes.set(scopeId, current);
  try { return await current; }
  finally { if (writes.get(scopeId) === current) writes.delete(scopeId); }
}

export async function getGifInScope(fileUniqueId: string, scopeId: string): Promise<GifDocument | null> {
  try {
    return await gifIndex.getDocument(docId(scopeId, fileUniqueId));
  } catch (error) {
    if (error instanceof MeilisearchApiError && error.cause?.code === "document_not_found") return null;
    throw error;
  }
}

export async function upsertGif(
  fileUniqueId: string, file_id: string, newTags: string[], newEmojis: string[], scopeId: string
): Promise<{ isNew: boolean }> {
  return inScope(scopeId, async () => {
    const existing = await getGifInScope(fileUniqueId, scopeId);
    const document: GifDocument = {
      id: docId(scopeId, fileUniqueId), file_unique_id: fileUniqueId, file_id, scope_id: scopeId,
      tags: [...new Set([...(existing?.tags ?? []), ...newTags])],
      emojis: [...new Set([...(existing?.emojis ?? []), ...newEmojis])],
      created_at: existing?.created_at ?? Date.now(), expired: false,
    };
    await waitForWrite(await gifIndex.addDocuments([document]));
    if (!existing) await trackGif(document.id).catch(console.error);
    return { isNew: !existing };
  });
}

export async function replaceTags(
  fileUniqueId: string, tags: string[], emojis: string[], scopeId: string
): Promise<boolean> {
  return inScope(scopeId, async () => {
    if (!(await getGifInScope(fileUniqueId, scopeId))) return false;
    await waitForWrite(await gifIndex.updateDocuments([{
      id: docId(scopeId, fileUniqueId), tags: [...new Set(tags)], emojis: [...new Set(emojis)],
    }]));
    return true;
  });
}
export const editTags = replaceTags;

export async function appendTags(
  fileUniqueId: string, newTags: string[], newEmojis: string[], scopeId: string
): Promise<GifDocument | null> {
  return inScope(scopeId, async () => {
    const existing = await getGifInScope(fileUniqueId, scopeId);
    if (!existing) return null;
    const updated = { ...existing,
      tags: [...new Set([...existing.tags, ...newTags])],
      emojis: [...new Set([...existing.emojis, ...newEmojis])],
    };
    await waitForWrite(await gifIndex.updateDocuments([{ id: updated.id, tags: updated.tags, emojis: updated.emojis }]));
    return updated;
  });
}

/** Save/merge the destination successfully before deleting the source. Same ID only refreshes. */
export async function replaceGif(
  oldFileUniqueId: string, newFileUniqueId: string, newFileId: string, scopeId: string
): Promise<boolean> {
  return inScope(scopeId, async () => {
    const oldDoc = await getGifInScope(oldFileUniqueId, scopeId);
    if (!oldDoc) return false;
    const newId = docId(scopeId, newFileUniqueId);
    const destination = newId === oldDoc.id ? oldDoc : await getGifInScope(newFileUniqueId, scopeId);
    await waitForWrite(await gifIndex.addDocuments([{
      id: newId, file_unique_id: newFileUniqueId, file_id: newFileId, scope_id: scopeId,
      tags: [...new Set([...(destination?.tags ?? []), ...oldDoc.tags])],
      emojis: [...new Set([...(destination?.emojis ?? []), ...oldDoc.emojis])],
      created_at: destination?.created_at ?? oldDoc.created_at, expired: false,
    }]));
    if (newId !== oldDoc.id) await waitForWrite(await gifIndex.deleteDocument(oldDoc.id));
    return true;
  });
}

export async function deleteGif(fileUniqueId: string, scopeId: string): Promise<boolean> {
  return inScope(scopeId, async () => {
    if (!(await getGifInScope(fileUniqueId, scopeId))) return false;
    await waitForWrite(await gifIndex.deleteDocument(docId(scopeId, fileUniqueId)));
    return true;
  });
}

export async function searchGifs(query: string, scopeIds: string[], limit = 50, offset = 0): Promise<GifDocument[]> {
  if (scopeIds.length === 0) return [];
  const result = await gifIndex.search(query, {
    filter: `(${scopeIds.map(scopeFilter).join(" OR ")}) AND ${visibleFilter}`,
    limit, offset, sort: ["created_at:desc"],
  });
  return result.hits;
}

/** Recheck the probed ID: a concurrent re-upload must not be expired by an older probe. */
export async function markGifExpired(document: GifDocument): Promise<void> {
  await inScope(document.scope_id, async () => {
    const current = await getGifInScope(document.file_unique_id, document.scope_id);
    if (current?.file_id === document.file_id) {
      await waitForWrite(await gifIndex.updateDocuments([{ id: current.id, expired: true }]));
    }
  });
}

export async function refreshGifFileId(fileUniqueId: string, newFileId: string, scopeId: string): Promise<void> {
  await inScope(scopeId, async () => {
    if (!(await getGifInScope(fileUniqueId, scopeId))) return;
    await waitForWrite(await gifIndex.updateDocuments([{
      id: docId(scopeId, fileUniqueId), file_id: newFileId, expired: false,
    }]));
  });
}

export async function getAllGifs(scopeId: string): Promise<GifDocument[]> {
  return inScope(scopeId, async () => {
  const all: GifDocument[] = [];
  const batchSize = 1000;
  for (let offset = 0; ; offset += batchSize) {
    const result = await gifIndex.getDocuments({ filter: scopeFilter(scopeId), limit: batchSize, offset });
    all.push(...result.results);
    if (result.results.length < batchSize) return all;
  }
  });
}

export async function getTagFacets(scopeId: string): Promise<Record<string, number>> {
  const result = await gifIndex.search("", {
    filter: `${scopeFilter(scopeId)} AND ${visibleFilter}`, facets: ["tags"], limit: 0,
  });
  return result.facetDistribution?.tags ?? {};
}

export async function getSearchBackupMetadata() {
  return { settings: await gifIndex.getSettings(), version: await client.getVersion(), documentCount: (await gifIndex.getStats()).numberOfDocuments };
}
