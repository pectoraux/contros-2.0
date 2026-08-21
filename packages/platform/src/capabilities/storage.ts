/**
 * Storage capability — persistent key-value, object-store, and binary-blob storage.
 *
 * Electron: node:fs + userData/*.json + userData/originals/<hash>.
 * Web: IndexedDB (key-value stores + binary blob store) + OPFS for large blobs.
 */
export interface Storage {
  // ── Key-value (for settings, app-settings.json equivalent) ──────────

  /** Read a setting; null when absent or unreadable. */
  get<T>(key: string): Promise<T | null>
  /** Write a setting; atomic within the key. */
  set<T>(key: string, value: T): Promise<void>
  /** Delete a setting. */
  delete(key: string): Promise<void>

  // ── Object stores (for recents, projects, chat history, autosave) ───

  /** Read one record from a named object store; null when absent. */
  readObject(store: string, key: string): Promise<unknown | null>
  /** Write one record into a named object store. */
  writeObject(store: string, key: string, value: unknown): Promise<void>
  /** Delete one record from a named object store. */
  deleteObject(store: string, key: string): Promise<void>
  /** List all keys in a named object store. */
  listObjects(store: string): Promise<string[]>

  // ── Binary blob storage (for originals archive, recovery copies) ─────

  /** Read a binary blob; null when absent. */
  readBlob(key: string): Promise<Uint8Array | null>
  /** Write a binary blob. */
  writeBlob(key: string, bytes: Uint8Array): Promise<void>
  /** Delete a binary blob. */
  deleteBlob(key: string): Promise<void>
}
