/**
 * Deterministic ID generation.
 *
 * IDs are for ENTITY IDENTITY (uniqueness), not content integrity.
 * They may include time + entropy (for uniqueness and sortability) —
 * this is distinct from content hashes (which are deterministic and
 * randomness-free). (master prompt §15.)
 *
 * Format: `<prefix>_<ULID>` where ULID is a 26-char Crockford-base32
 * time-ordered lexicographically-sortable identifier (48-bit ms timestamp
 * + 80-bit entropy). ULIDs are monotonically sortable and collision-resistant.
 */

import { webcrypto } from 'node:crypto'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ENCODE_TIME_LEN = 10
const ENCODE_RAND_LEN = 16

function encodeTime(now: number): string {
  let ts = Math.floor(now)
  if (ts < 0) ts = 0
  // ULID epoch overflow protection (year 10889+); not a concern here.
  let out = ''
  for (let i = ENCODE_TIME_LEN - 1; i >= 0; i--) {
    const mod = ts % 32
    out = CROCKFORD[mod]! + out
    ts = Math.floor(ts / 32)
  }
  return out
}

function encodeRandom(): string {
  const bytes = new Uint8Array(ENCODE_RAND_LEN)
  webcrypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < ENCODE_RAND_LEN; i++) {
    out += CROCKFORD[bytes[i] % 32]
  }
  return out
}

/**
 * Generate a ULID (26 chars, Crockford base32, time-ordered).
 */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom()
}

/**
 * Generate a prefixed entity ID.
 * Examples: `org_01J...`, `usr_01J...`, `ws_01J...`, `proj_01J...`,
 * `rev_01J...`, `aud_01J...`.
 */
export function entityId(prefix: string, now: number = Date.now()): string {
  return `${prefix}_${ulid(now)}`
}

// Standard prefixes (centralized to avoid drift)
export const ID_PREFIX = {
  user: 'usr',
  authBinding: 'auth',
  organization: 'org',
  membership: 'mbr',
  workspace: 'ws',
  project: 'proj',
  audit: 'aud',
  revision: 'rev',
} as const
