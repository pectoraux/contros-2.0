/**
 * Contractor GenOffice — Object Storage abstraction.
 *
 * Content-addressed, immutable artifact storage. The artifact id is derived
 * from the SHA-256 content hash, so identical content always addresses the
 * same artifact — `put` is idempotent and content-addressed. (Phase 1
 * section 17; master prompt §15; architecture/DOMAIN-AUTHORITY.md §7.)
 *
 * Zero external dependencies (only `node:crypto`, `node:fs/promises`,
 * `node:path`). No provider coupling — no S3 / Azure Blob / GCS imports.
 * Concrete providers, when introduced, implement the `ObjectStore` interface
 * behind this boundary; the domain never imports a provider SDK directly.
 *
 * License: Apache-2.0.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { StoredArtifact } from '../domain/types.js'
import { contentHashBytes } from '../domain/hashing.js'

/**
 * Derive the artifact id from a content hash.
 *
 * Format: `sha256_<64-hex>`. Same content -> same id, always. Content is
 * therefore addressable by id alone: the id IS the content hash.
 */
export function artifactIdFromHash(contentHash: string): string {
  return `sha256_${contentHash}`
}

/**
 * ObjectStore — the object-storage port.
 *
 * Methods are async because concrete providers may be remote (HTTP) or local
 * (filesystem). The interface is provider-agnostic: a future S3-backed
 * implementation, an Azure-Blob-backed implementation, or a Postgres
 * large-object-backed implementation all satisfy this interface.
 *
 * Semantics:
 *  - `put` is IDEMPOTENT: putting identical bytes twice yields the same
 *    artifact (same id, same storedAt). First-write-wins for metadata such
 *    as contentType.
 *  - Artifacts are IMMUTABLE: there is no `update` / `delete` on this
 *    interface. Corrections occur by writing a NEW artifact (different
 *    content -> different id) and referencing the new id.
 *  - `get` returns a defensive copy of the bytes (mutations by the caller
 *    MUST NOT corrupt stored state).
 *  - `head` returns metadata WITHOUT reading the bytes (fast existence +
 *    size check).
 *  - `exists` is a fast existence check (does not read bytes or metadata).
 */
export interface ObjectStore {
  /**
   * Store `content` and return its artifact metadata. Computes the content
   * hash, derives the artifactId, and writes the bytes (idempotent: same
   * content -> same artifactId, no duplicate write, original storedAt
   * preserved).
   */
  put(content: Uint8Array, contentType: string): Promise<StoredArtifact>

  /**
   * Return the stored bytes for `artifactId`, or `null` if absent. The
   * returned array is a copy; mutating it does not affect stored state.
   */
  get(artifactId: string): Promise<Uint8Array | null>

  /**
   * Return the artifact metadata for `artifactId` WITHOUT reading the bytes,
   * or `null` if absent. Faster than `get` for size/type/exists checks.
   */
  head(artifactId: string): Promise<StoredArtifact | null>

  /**
   * Fast existence check: would `get(artifactId)` return non-null bytes?
   */
  exists(artifactId: string): Promise<boolean>
}

// ────────────────────────────────────────────────────────────
// InMemoryObjectStore
// ────────────────────────────────────────────────────────────

interface MemoryEntry {
  /** Defensive copy of the stored bytes (callers cannot mutate it). */
  readonly content: Uint8Array
  readonly artifact: StoredArtifact
}

/**
 * InMemoryObjectStore — stores bytes in a Map keyed by artifactId.
 *
 * For unit tests and ephemeral dev sessions. NOT durable: state is lost on
 * process exit. Use `LocalFsObjectStore` or a provider-backed store for
 * persistence.
 */
export class InMemoryObjectStore implements ObjectStore {
  private readonly entries = new Map<string, MemoryEntry>()

  async put(content: Uint8Array, contentType: string): Promise<StoredArtifact> {
    const hash = contentHashBytes(content)
    const artifactId = artifactIdFromHash(hash)
    const existing = this.entries.get(artifactId)
    if (existing) {
      // Content-addressed idempotency: return the original artifact
      // (preserving the original storedAt and contentType).
      return existing.artifact
    }
    // Defensive copy: the caller must not be able to mutate stored state
    // by holding onto the array they passed in.
    const copy = new Uint8Array(content.byteLength)
    copy.set(content)
    const artifact: StoredArtifact = {
      artifactId,
      contentHash: hash,
      sizeBytes: copy.byteLength,
      contentType,
      storedAt: new Date().toISOString(),
    }
    this.entries.set(artifactId, { content: copy, artifact })
    return artifact
  }

  async get(artifactId: string): Promise<Uint8Array | null> {
    const entry = this.entries.get(artifactId)
    if (!entry) return null
    // Return a defensive copy so callers cannot mutate the stored bytes.
    const copy = new Uint8Array(entry.content.byteLength)
    copy.set(entry.content)
    return copy
  }

  async head(artifactId: string): Promise<StoredArtifact | null> {
    return this.entries.get(artifactId)?.artifact ?? null
  }

  async exists(artifactId: string): Promise<boolean> {
    return this.entries.has(artifactId)
  }
}

// ────────────────────────────────────────────────────────────
// LocalFsObjectStore
// ────────────────────────────────────────────────────────────

/**
 * LocalFsObjectStore — content-addressed files in a local directory.
 *
 * For local dev and integration tests. NOT suitable for production
 * multi-node deployments (no replication, no sharding, no concurrent-writer
 * guarantees beyond content-addressing).
 *
 * Layout under `baseDir`:
 *  - `<artifactId>.bin`  — the raw bytes
 *  - `<artifactId>.meta.json` — the StoredArtifact metadata (JSON)
 *
 * Because the artifact id IS the content hash, two writers racing to store
 * the same content write identical `.bin` bytes; the metadata may differ
 * only in `storedAt` (a wall-clock timestamp that is NOT part of the
 * content hash). The first writer's metadata wins (subsequent `put` calls
 * for the same id return the existing metadata without rewriting).
 */
export class LocalFsObjectStore implements ObjectStore {
  private readonly baseDir: string
  /**
   * Resolves once the base directory has been created (idempotent mkdir).
   * All public methods await this to ensure the directory exists before
   * any file operation.
   */
  private readonly ready: Promise<void>

  constructor(baseDir: string) {
    this.baseDir = baseDir
    // `mkdir({ recursive: true })` resolves to `string | undefined` (the
    // first directory created); we only care that it resolves, so coerce
    // to `Promise<void>`.
    this.ready = mkdir(baseDir, { recursive: true }).then(() => undefined)
  }

  private binPath(artifactId: string): string {
    return join(this.baseDir, `${artifactId}.bin`)
  }

  private metaPath(artifactId: string): string {
    return join(this.baseDir, `${artifactId}.meta.json`)
  }

  async put(content: Uint8Array, contentType: string): Promise<StoredArtifact> {
    await this.ready
    const hash = contentHashBytes(content)
    const artifactId = artifactIdFromHash(hash)
    // Content-addressed idempotency: if metadata already exists, return it
    // without rewriting the bytes (preserves the original storedAt).
    const existing = await this.readMeta(artifactId)
    if (existing) return existing
    const artifact: StoredArtifact = {
      artifactId,
      contentHash: hash,
      sizeBytes: content.byteLength,
      contentType,
      storedAt: new Date().toISOString(),
    }
    await writeFile(this.binPath(artifactId), content)
    await writeFile(this.metaPath(artifactId), JSON.stringify(artifact), 'utf8')
    return artifact
  }

  async get(artifactId: string): Promise<Uint8Array | null> {
    await this.ready
    try {
      const buf = await readFile(this.binPath(artifactId))
      // Return a plain Uint8Array (not a Node Buffer) so callers see the
      // abstract type declared by the interface.
      return new Uint8Array(buf)
    } catch (e) {
      if (isEnoent(e)) return null
      throw e
    }
  }

  async head(artifactId: string): Promise<StoredArtifact | null> {
    await this.ready
    return this.readMeta(artifactId)
  }

  async exists(artifactId: string): Promise<boolean> {
    await this.ready
    try {
      await stat(this.binPath(artifactId))
      return true
    } catch (e) {
      if (isEnoent(e)) return false
      throw e
    }
  }

  private async readMeta(artifactId: string): Promise<StoredArtifact | null> {
    try {
      const buf = await readFile(this.metaPath(artifactId))
      const json = JSON.parse(buf.toString('utf8')) as StoredArtifact
      // Reconstruct a clean object (do not trust on-disk JSON shape blindly).
      return {
        artifactId: json.artifactId,
        contentHash: json.contentHash,
        sizeBytes: json.sizeBytes,
        contentType: json.contentType,
        storedAt: json.storedAt,
      }
    } catch (e) {
      if (isEnoent(e)) return null
      throw e
    }
  }
}

/**
 * Narrow an unknown caught value to a Node ENOENT (file-not-found) error.
 * Used to translate fs ENOENT into a clean `null` return.
 */
function isEnoent(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
