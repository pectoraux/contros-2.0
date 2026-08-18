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
}
