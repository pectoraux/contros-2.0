/**
 * WaitlistRepository — sign-up waitlist (Phase 2C.3).
 * Users sign up → pending. Admin approves → user created.
 */

import type { DbClient, DbRow } from '../db-client.js'

interface WaitlistRow extends DbRow {
  id: string
  email: string
  status: string
  created_at: Date
  approved_by: string | null
  approved_at: Date | null
  created_user_id: string | null
  display_name: string | null
}

export interface WaitlistEntry {
  readonly id: string
  readonly email: string
  readonly status: 'pending' | 'approved' | 'rejected'
  readonly createdAt: string
  readonly approvedBy: string | null
  readonly approvedAt: string | null
  readonly createdUserId: string | null
  readonly displayName: string | null
}

function mapRow(r: WaitlistRow): WaitlistEntry {
  return {
    id: r.id,
    email: r.email,
    status: r.status as WaitlistEntry['status'],
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    approvedBy: r.approved_by,
    approvedAt: r.approved_at instanceof Date ? r.approved_at.toISOString() : (r.approved_at ? String(r.approved_at) : null),
    createdUserId: r.created_user_id,
    displayName: r.display_name,
  }
}

export class WaitlistRepository {
  constructor(private readonly db: DbClient) {}

  async create(id: string, email: string, displayName: string | null): Promise<WaitlistEntry> {
    const rows = await this.db.queryReturning<WaitlistRow>(
      `INSERT INTO waitlist (id, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING *`,
      [id, email.toLowerCase(), displayName],
    )
    if (rows.length === 0) {
      // Already exists — return the existing entry
      const existing = await this.db.query<WaitlistRow>(`SELECT * FROM waitlist WHERE email = $1`, [email.toLowerCase()])
      return mapRow(existing[0]!)
    }
    return mapRow(rows[0]!)
  }

  async listPending(): Promise<WaitlistEntry[]> {
    const rows = await this.db.query<WaitlistRow>(`SELECT * FROM waitlist WHERE status = 'pending' ORDER BY created_at`)
    return rows.map(mapRow)
  }

  async listAll(): Promise<WaitlistEntry[]> {
    const rows = await this.db.query<WaitlistRow>(`SELECT * FROM waitlist ORDER BY created_at DESC`)
    return rows.map(mapRow)
  }

  async getById(id: string): Promise<WaitlistEntry | null> {
    const rows = await this.db.query<WaitlistRow>(`SELECT * FROM waitlist WHERE id = $1`, [id])
    return rows[0] ? mapRow(rows[0]) : null
  }

  async approve(id: string, approvedBy: string, createdUserId: string): Promise<WaitlistEntry | null> {
    const rows = await this.db.queryReturning<WaitlistRow>(
      `UPDATE waitlist SET status = 'approved', approved_by = $2, approved_at = now(), created_user_id = $3
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, approvedBy, createdUserId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  async findByEmail(email: string): Promise<WaitlistEntry | null> {
    const rows = await this.db.query<WaitlistRow>(`SELECT * FROM waitlist WHERE email = $1`, [email.toLowerCase()])
    return rows[0] ? mapRow(rows[0]) : null
  }
}
