/**
 * MagicLinkRepository — passwordless email magic-link tokens (ADR-0009 D3).
 *
 * Stores HMAC-signed, single-use, short-lived tokens. The raw token is never
 * stored — only its SHA-256 hash. On verify, the token is consumed
 * (used_at set) and cannot be reused.
 */

import type { DbClient, DbRow } from '../db-client.js'

interface MagicLinkRow extends DbRow {
  token_hash: string
  email: string
  expires_at: Date
  used_at: Date | null
  created_at: Date
}

export interface MagicLink {
  readonly tokenHash: string
  readonly email: string
  readonly expiresAt: string
  readonly usedAt: string | null
  readonly createdAt: string
}

function mapRow(r: MagicLinkRow): MagicLink {
  return {
    tokenHash: r.token_hash,
    email: r.email,
    expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
    usedAt: r.used_at instanceof Date ? r.used_at.toISOString() : (r.used_at ? String(r.used_at) : null),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }
}

export class MagicLinkRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * Create a magic-link token. The tokenHash is the SHA-256 of the raw token;
   * the raw token is never stored. Returns the stored record.
   */
  async create(tokenHash: string, email: string, expiresAt: string, createdAt: string): Promise<MagicLink> {
    const rows = await this.db.queryReturning<MagicLinkRow>(
      `INSERT INTO magic_links (token_hash, email, expires_at, created_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tokenHash, email, expiresAt, createdAt],
    )
    return mapRow(rows[0]!)
  }

  /**
   * Find an unused, non-expired magic link by token hash. Returns null if not
   * found, already used, or expired.
   */
  async findValid(tokenHash: string): Promise<MagicLink | null> {
    const rows = await this.db.query<MagicLinkRow>(
      `SELECT * FROM magic_links
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  /**
   * Consume a magic-link token (mark it used). Single-use enforcement: the
   * UPDATE only succeeds if used_at is still NULL. Returns true if consumed,
   * false if already used (race-safe via the WHERE clause).
   */
  async consume(tokenHash: string): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE magic_links SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL`,
      [tokenHash],
    )
    return result.affectedRows > 0
  }

  /**
   * Delete expired tokens (housekeeping). Returns the number deleted.
   */
  async deleteExpired(): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM magic_links WHERE expires_at < now()`,
      [],
    )
    return result.affectedRows
  }
}
