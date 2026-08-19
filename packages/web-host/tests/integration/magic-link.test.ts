/**
 * Magic-link auth tests — passwordless email authentication (ADR-0009 D3).
 *
 * Runs against real PGlite (no mocks). Verifies:
 *  - requestLink generates a token + stores its hash (raw never stored)
 *  - verifyLink consumes the token (single-use)
 *  - verifyLink creates a User + AuthProviderBinding on first use
 *  - verifyLink resolves the existing user on subsequent links
 *  - expired/invalid tokens are rejected
 *  - the raw token is never stored in the DB (only its SHA-256 hash)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import {
  PgLiteClient, FOUNDATION_MIGRATION_SQL, COMMERCIAL_MIGRATION_SQL, MAGIC_LINKS_MIGRATION_SQL,
  applyMigration, UserRepository, MagicLinkRepository,
} from '@contractor/core/persistence'
import { MagicLinkAuthService } from '../../src/magic-link.js'
import { createHash } from 'node:crypto'

let db: PgLiteClient
let users: UserRepository
let magicLinks: MagicLinkRepository
let auth: MagicLinkAuthService

const SECRET = 'b'.repeat(64)

beforeAll(async () => {
  const pg = new PGlite()
  db = new PgLiteClient(pg)
  await applyMigration(db, FOUNDATION_MIGRATION_SQL)
  await applyMigration(db, COMMERCIAL_MIGRATION_SQL)
  await applyMigration(db, MAGIC_LINKS_MIGRATION_SQL)
  users = new UserRepository(db)
  magicLinks = new MagicLinkRepository(db)
  auth = new MagicLinkAuthService(users, magicLinks, {
    linkSecret: SECRET, linkTtlSeconds: 900, appBaseUrl: 'https://app.test',
  })
})
afterAll(async () => { await db.close() })

describe('Magic-link auth (ADR-0009 D3)', () => {
  it('requestLink stores a token hash (not the raw token) + returns a link URL', async () => {
    const result = await auth.requestLink('alice@test.com')
    expect(result.email).toBe('alice@test.com')
    expect(result.linkUrl).toContain('https://app.test/api/auth/verify?token=')
    expect(result.token).toBeDefined()
    // The raw token must NOT be in the DB — only its SHA-256 hash.
    const tokenHash = createHash('sha256').update(result.token).digest('hex')
    const rows = await db.query<{ token_hash: string }>(
      `SELECT token_hash FROM magic_links WHERE email = $1`, ['alice@test.com'],
    )
    expect(rows[0]!.token_hash).toBe(tokenHash)
    expect(rows[0]!.token_hash).not.toBe(result.token) // hash, not raw
  })

  it('verifyLink consumes the token + creates a new User + binding on first use', async () => {
    const req = await auth.requestLink('bob@test.com')
    const result = await auth.verifyLink(req.token)
    expect(result.email).toBe('bob@test.com')
    expect(result.isNewUser).toBe(true)
    expect(result.userId).toBeDefined()
    // The token is consumed (used_at is set)
    const tokenHash = createHash('sha256').update(req.token).digest('hex')
    const rows = await db.query<{ used_at: Date | null }>(
      `SELECT used_at FROM magic_links WHERE token_hash = $1`, [tokenHash],
    )
    expect(rows[0]!.used_at).not.toBeNull()
    // A User + binding exist
    const binding = await users.getBindingBySubject('email', 'bob@test.com')
    expect(binding).not.toBeNull()
    expect(binding!.userId).toBe(result.userId)
  })

  it('verifyLink rejects a reused token (single-use)', async () => {
    const req = await auth.requestLink('carol@test.com')
    await auth.verifyLink(req.token)
    await expect(auth.verifyLink(req.token)).rejects.toThrow(/invalid_or_expired|already_used/)
  })

  it('verifyLink rejects an invalid (non-existent) token', async () => {
    await expect(auth.verifyLink('nonexistent.token')).rejects.toThrow(/invalid_or_expired/)
  })

  it('verifyLink resolves the existing user on a second link (not a new user)', async () => {
    const req1 = await auth.requestLink('dave@test.com')
    const r1 = await auth.verifyLink(req1.token)
    const req2 = await auth.requestLink('dave@test.com')
    const r2 = await auth.verifyLink(req2.token)
    expect(r2.isNewUser).toBe(false)
    expect(r2.userId).toBe(r1.userId) // same user
  })

  it('requestLink rejects an invalid email', async () => {
    await expect(auth.requestLink('not-an-email')).rejects.toThrow(/valid email/)
    await expect(auth.requestLink('')).rejects.toThrow(/valid email/)
  })

  it('expired tokens are rejected (findValid excludes expired)', async () => {
    // Insert an already-expired token directly
    const tokenHash = createHash('sha256').update('expired-token').digest('hex')
    await magicLinks.create(tokenHash, 'expired@test.com', new Date(Date.now() - 1000).toISOString(), new Date().toISOString())
    await expect(auth.verifyLink('expired-token')).rejects.toThrow(/invalid_or_expired/)
  })
})
