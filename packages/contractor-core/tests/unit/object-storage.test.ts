import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  InMemoryObjectStore,
  LocalFsObjectStore,
  artifactIdFromHash,
  type ObjectStore,
} from '../../src/storage/object-storage.js'
import { contentHashBytes } from '../../src/domain/hashing.js'

// ── Helpers ─────────────────────────────────────────────────

const enc = new TextEncoder()

/** A content-id that does NOT exist (valid format, no artifact behind it). */
const ABSENT_ID = 'sha256_' + '0'.repeat(64)

/** SHA-256 of empty input — well-known, used to assert empty-content hashing. */
const EMPTY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function expectedHash(content: Uint8Array): string {
  return contentHashBytes(content)
}

function expectedId(content: Uint8Array): string {
  return artifactIdFromHash(expectedHash(content))
}

/** Byte-wise equality (works across Uint8Array / Buffer views). */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// ── Fixture plumbing ────────────────────────────────────────

interface StoreFixture {
  store: ObjectStore
  cleanup: () => Promise<void>
}

/**
 * Run the full ObjectStore contract suite against any fixture.
 * Both InMemoryObjectStore and LocalFsObjectStore must satisfy it.
 */
function runObjectStoreSuite(
  name: string,
  makeFixture: () => Promise<StoreFixture>,
): void {
  describe(name, () => {
    let store: ObjectStore
    let cleanup: () => Promise<void>

    beforeEach(async () => {
      const fixture = await makeFixture()
      store = fixture.store
      cleanup = fixture.cleanup
    })

    afterEach(async () => {
      await cleanup()
    })

    // ── put: metadata correctness ───────────────────────────

    it('put returns metadata with correct content hash, size, content type', async () => {
      const content = enc.encode('hello world')
      const artifact = await store.put(content, 'text/plain')

      expect(artifact.contentHash).toBe(expectedHash(content))
      expect(artifact.artifactId).toBe(expectedId(content))
      expect(artifact.sizeBytes).toBe(content.byteLength)
      expect(artifact.contentType).toBe('text/plain')
      // storedAt is an ISO-8601 string
      expect(artifact.storedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
      // artifactId is the content-addressed form sha256_<hex>
      expect(artifact.artifactId).toMatch(/^sha256_[0-9a-f]{64}$/)
    })

    // ── idempotency ────────────────────────────────────────

    it('same content -> same artifactId (content-addressed, idempotent)', async () => {
      const content = enc.encode('same bytes')
      const a1 = await store.put(content, 'text/plain')
      const a2 = await store.put(content, 'text/plain')

      expect(a1.artifactId).toBe(a2.artifactId)
      expect(a1.contentHash).toBe(a2.contentHash)
      expect(a1.sizeBytes).toBe(a2.sizeBytes)
      // Idempotent: same storedAt (first-write-wins, not rewritten)
      expect(a1.storedAt).toBe(a2.storedAt)
    })

    it('different content -> different artifactId', async () => {
      const a1 = await store.put(enc.encode('first'), 'text/plain')
      const a2 = await store.put(enc.encode('second'), 'text/plain')

      expect(a1.artifactId).not.toBe(a2.artifactId)
      expect(a1.contentHash).not.toBe(a2.contentHash)
    })

    // ── get ────────────────────────────────────────────────

    it('get returns the bytes (or null if absent)', async () => {
      const content = enc.encode('payload bytes')
      const artifact = await store.put(content, 'application/octet-stream')

      const got = await store.get(artifact.artifactId)
      expect(got).not.toBeNull()
      expect(got!.byteLength).toBe(content.byteLength)
      expect(bytesEqual(got!, content)).toBe(true)

      // absent -> null
      const missing = await store.get(ABSENT_ID)
      expect(missing).toBeNull()
    })

    it('get returns a defensive copy (mutating the result does not corrupt storage)', async () => {
      const content = enc.encode('immutable please')
      const artifact = await store.put(content, 'text/plain')

      const got1 = await store.get(artifact.artifactId)
      expect(got1).not.toBeNull()
      // Mutate the returned copy.
      got1![0] = got1![0]! ^ 0xff

      // A fresh get must still return the ORIGINAL bytes.
      const got2 = await store.get(artifact.artifactId)
      expect(got2).not.toBeNull()
      expect(bytesEqual(got2!, content)).toBe(true)
    })

    // ── head ───────────────────────────────────────────────

    it('head returns metadata without bytes (or null if absent)', async () => {
      const content = enc.encode('meta only')
      const artifact = await store.put(content, 'text/plain')

      const head = await store.head(artifact.artifactId)
      expect(head).not.toBeNull()
      expect(head!.artifactId).toBe(artifact.artifactId)
      expect(head!.contentHash).toBe(artifact.contentHash)
      expect(head!.sizeBytes).toBe(artifact.sizeBytes)
      expect(head!.contentType).toBe(artifact.contentType)
      expect(head!.storedAt).toBe(artifact.storedAt)

      // absent -> null
      const missing = await store.head(ABSENT_ID)
      expect(missing).toBeNull()
    })

    // ── exists ─────────────────────────────────────────────

    it('exists returns true/false correctly', async () => {
      const content = enc.encode('exists check')
      const artifact = await store.put(content, 'text/plain')

      expect(await store.exists(artifact.artifactId)).toBe(true)
      expect(await store.exists(ABSENT_ID)).toBe(false)
    })

    it('exists returns false before put and true after put', async () => {
      const content = enc.encode('transition')
      const id = expectedId(content)

      expect(await store.exists(id)).toBe(false)
      await store.put(content, 'text/plain')
      expect(await store.exists(id)).toBe(true)
    })

    // ── edge cases ────────────────────────────────────────

    it('handles large content (1 MB)', async () => {
      const content = new Uint8Array(1024 * 1024)
      // Deterministic non-trivial content: byte value = index mod 256.
      for (let i = 0; i < content.length; i++) content[i] = i & 0xff

      const artifact = await store.put(content, 'application/octet-stream')
      expect(artifact.sizeBytes).toBe(1024 * 1024)
      expect(artifact.contentHash).toBe(expectedHash(content))
      expect(artifact.contentHash).toMatch(/^[0-9a-f]{64}$/)

      const got = await store.get(artifact.artifactId)
      expect(got).not.toBeNull()
      expect(got!.byteLength).toBe(content.byteLength)
      expect(bytesEqual(got!, content)).toBe(true)

      // spot check first + last
      expect(got![0]).toBe(content[0])
      expect(got![content.length - 1]).toBe(content[content.length - 1])
    })

    it('handles empty content (0 bytes)', async () => {
      const content = new Uint8Array(0)

      const artifact = await store.put(content, 'application/octet-stream')
      expect(artifact.sizeBytes).toBe(0)
      expect(artifact.contentHash).toBe(expectedHash(content))
      // SHA-256 of empty input is a well-known constant
      expect(artifact.contentHash).toBe(EMPTY_SHA256)
      expect(artifact.artifactId).toBe(`sha256_${EMPTY_SHA256}`)

      const got = await store.get(artifact.artifactId)
      expect(got).not.toBeNull()
      expect(got!.byteLength).toBe(0)

      expect(await store.exists(artifact.artifactId)).toBe(true)
      expect(await store.head(artifact.artifactId)).not.toBeNull()
    })

    it('supports binary content with all byte values (0..255)', async () => {
      const content = new Uint8Array(256)
      for (let i = 0; i < 256; i++) content[i] = i

      const artifact = await store.put(content, 'application/octet-stream')
      const got = await store.get(artifact.artifactId)
      expect(got).not.toBeNull()
      expect(bytesEqual(got!, content)).toBe(true)
      expect(artifact.sizeBytes).toBe(256)
    })

    it('content type is preserved (different content types on different artifacts)', async () => {
      const textContent = enc.encode('text payload')
      const binContent = new Uint8Array([0, 1, 2, 3, 4, 5])

      const a1 = await store.put(textContent, 'text/plain')
      const a2 = await store.put(binContent, 'application/octet-stream')

      expect(a1.contentType).toBe('text/plain')
      expect(a2.contentType).toBe('application/octet-stream')
      expect(a1.artifactId).not.toBe(a2.artifactId)
    })
  })
}

// ── Run the suite against both implementations ──────────────

runObjectStoreSuite('InMemoryObjectStore', async () => ({
  store: new InMemoryObjectStore(),
  cleanup: async () => {
    /* nothing to clean up — GC reclaims the Map */
  },
}))

runObjectStoreSuite('LocalFsObjectStore (temp dir)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'contractor-object-storage-'))
  return {
    store: new LocalFsObjectStore(dir),
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true })
    },
  }
})
