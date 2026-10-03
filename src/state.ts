// One polling process owns state writes. Backups take the same lock to capture
// Redis and Meilisearch between fully completed updates, then release before upload.
let tail: Promise<unknown> = Promise.resolve();
export async function withStateLock<T>(operation: () => Promise<T>): Promise<T> {
  const current = tail.catch(() => {}).then(operation);
  tail = current;
  return current;
}
