/**
 * Canonical content hashing — ONE mechanism for revision integrity.
 *
 * A content hash identifies CONTENT (canonicalized bytes), not authorship.
 * Authorship, authorization, actor identity, and timestamps live in audit
 * events — they are NEVER part of the content hash. (master prompt §15.)
 *
 * Rules (master prompt §14):
 *  - canonicalized content (stable key ordering, no unstable fields)
 *  - deterministic (same content -> same hash, always)
 *  - SHA-256 (one mechanism; do not invent multiple hashing systems)
 *  - no wall-clock timestamps, no randomness, no mutable external state
 *
 * This module has ZERO external dependencies (only node:crypto).
 */

import { createHash } from 'node:crypto'

/**
 * Canonicalize a value for hashing:
 *  - object keys sorted recursively (stable ordering)
 *  - arrays preserve order (order is semantically significant)
 *  - undefined values omitted (they are not canonical content)
 *  - null preserved (null is meaningful — "explicitly absent")
 *  - no prototype chain traversal (own enumerable properties only)
 *
 * This produces a deterministic string representation suitable for SHA-256.
 */
export function canonicalize(value: unknown): string {
  return canonicalizeValue(value, '')
}

function canonicalizeValue(value: unknown, indent: string): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined' // omitted at the object level
  const t = typeof value
  if (t === 'string') return JSON.stringify(value)
  if (t === 'number') return Number.isFinite(value) ? String(value) : 'NaN'
  if (t === 'boolean') return String(value)
  if (t === 'bigint') return `${value}n`
  if (value instanceof Date) {
    // Dates are canonicalized as their ISO UTC string. Callers must NOT
    // pass wall-clock timestamps into content hashes (master prompt §14);
    // a Date field in hashed content must be a deterministic domain value
    // (e.g. a contract date), not "now".
    return `date:${value.toISOString()}`
  }
  if (Array.isArray(value)) {
    const items = value
      .filter((v) => v !== undefined)
      .map((v) => canonicalizeValue(v, indent + '  '))
      .join(',')
    return `[${items}]`
  }
  if (t === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
    const entries = keys
      .map((k) => `${JSON.stringify(k)}:${canonicalizeValue(obj[k], indent + '  ')}`)
      .join(',')
    return `{${entries}}`
  }
  // Functions, symbols, etc. are not canonical content.
  return 'unhashable'
}

/**
 * Compute the canonical content hash (SHA-256, hex) of a value.
 * This is the ONE mechanism for revision integrity.
 */
export function contentHash(value: unknown): string {
  const canon = canonicalize(value)
  return createHash('sha256').update(canon, 'utf8').digest('hex')
}

/**
 * Compute the canonical content hash (SHA-256, hex) of raw bytes.
 *
 * Raw bytes are already canonical — there is no canonicalization step.
 * This is the SAME SHA-256 mechanism as `contentHash`, applied to binary
 * content (e.g. object-storage artifacts). (master prompt §15 — ONE hashing
 * mechanism; do not invent a parallel system for bytes.)
 */
export function contentHashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Verify that a value's canonical hash matches an expected hash.
 * Used to verify revision integrity on replay.
 */
export function verifyContentHash(value: unknown, expected: string): boolean {
  return contentHash(value) === expected
}
