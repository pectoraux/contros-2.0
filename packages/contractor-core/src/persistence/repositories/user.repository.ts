/**
 * User + AuthProviderBinding repository.
 *
 * Users are GLOBAL (not tenant-scoped) — a user may belong to multiple
 * organizations. AuthProviderBindings are global (linked to a user).
 * Tenant scoping applies to Memberships, not to Users themselves.
 */

import type { DbClient, DbRow } from '../db-client.js'
import type { User, AuthProviderBinding } from '../../domain/types.js'

interface UserRow extends DbRow {
  id: string
  email: string | null
  display_name: string | null
  status: string
  created_at: Date
}

interface AuthBindingRow extends DbRow {
  id: string
  user_id: string
  provider: string
  subject: string
  created_at: Date
  last_used_at: Date | null
}

function mapUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    status: r.status as User['status'],
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }
}

function mapBinding(r: AuthBindingRow): AuthProviderBinding {
  return {
    id: r.id,
    userId: r.user_id,
    provider: r.provider,
    subject: r.subject,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    lastUsedAt: r.last_used_at instanceof Date ? r.last_used_at.toISOString() : (r.last_used_at ? String(r.last_used_at) : null),
  }
}

export class UserRepository {
  constructor(private readonly db: DbClient) {}

  async create(user: User): Promise<User> {
    const rows = await this.db.queryReturning<UserRow>(
      `INSERT INTO users (id, email, display_name, status, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user.id, user.email, user.displayName, user.status, user.createdAt],
    )
    return mapUser(rows[0]!)
  }

  async getById(id: string): Promise<User | null> {
    const rows = await this.db.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [id])
    return rows[0] ? mapUser(rows[0]) : null
  }

  async getByEmail(email: string): Promise<User | null> {
    const rows = await this.db.query<UserRow>(`SELECT * FROM users WHERE email = $1`, [email])
    return rows[0] ? mapUser(rows[0]) : null
  }

  async createBinding(b: AuthProviderBinding): Promise<AuthProviderBinding> {
    const rows = await this.db.queryReturning<AuthBindingRow>(
      `INSERT INTO auth_provider_bindings (id, user_id, provider, subject, created_at, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [b.id, b.userId, b.provider, b.subject, b.createdAt, b.lastUsedAt],
    )
    return mapBinding(rows[0]!)
  }

  async getBindingBySubject(provider: string, subject: string): Promise<AuthProviderBinding | null> {
    const rows = await this.db.query<AuthBindingRow>(
      `SELECT * FROM auth_provider_bindings WHERE provider = $1 AND subject = $2`,
      [provider, subject],
    )
    return rows[0] ? mapBinding(rows[0]) : null
  }

  async listBindingsForUser(userId: string): Promise<AuthProviderBinding[]> {
    const rows = await this.db.query<AuthBindingRow>(
      `SELECT * FROM auth_provider_bindings WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    )
    return rows.map(mapBinding)
  }

  // ── Phase 2C.3.2: password-auth support (repository owns the SQL) ──────

  /**
   * Create a user with a password_hash (for password-auth users).
   * The password_hash is already hashed by the caller (PasswordAuthService).
   */
  async createWithPassword(user: User, passwordHash: string): Promise<User> {
    const rows = await this.db.queryReturning<UserRow>(
      `INSERT INTO users (id, email, display_name, status, created_at, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user.id, user.email, user.displayName, user.status, user.createdAt, passwordHash],
    )
    return mapUser(rows[0]!)
  }

  /**
   * Get a user's password_hash (for login verification).
   * Returns null if no password is set.
   */
  async getPasswordHash(userId: string): Promise<string | null> {
    const rows = await this.db.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId],
    )
    return rows[0]?.password_hash ?? null
  }

  /**
   * Update a user's password_hash.
   */
  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db.execute(
      `UPDATE users SET password_hash = $2 WHERE id = $1`,
      [userId, passwordHash],
    )
  }

  /**
   * Get the is_demo flag for a user.
   */
  async getIsDemo(userId: string): Promise<boolean> {
    const rows = await this.db.query<{ is_demo: boolean }>(
      `SELECT is_demo FROM users WHERE id = $1`,
      [userId],
    )
    return rows[0]?.is_demo ?? false
  }

  /**
   * Create a demo user (is_demo=true, no password). For the bootstrap script.
   */
  async createDemoUser(user: User): Promise<User> {
    const rows = await this.db.queryReturning<UserRow>(
      `INSERT INTO users (id, email, display_name, status, created_at, is_demo)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [user.id, user.email, user.displayName, user.status, user.createdAt],
    )
    return mapUser(rows[0]!)
  }

  /**
   * Set the is_demo flag for an existing user. Used by the bootstrap script
   * to ensure demo users created before the is_demo column existed get the flag.
   */
  async setDemoFlag(userId: string, isDemo: boolean): Promise<void> {
    await this.db.execute(
      `UPDATE users SET is_demo = $2 WHERE id = $1`,
      [userId, isDemo],
    )
  }
}
