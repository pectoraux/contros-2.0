/**
 * Membership repository — tenant-scoped.
 *
 * A Membership links a User to an Organization (Tenant) with a Role.
 * Every query enforces tenant scope. (Phase 1 section 7/11.)
 */

import type { DbClient, DbRow } from '../db-client.js'
import type { Membership, Role } from '../../domain/types.js'

interface MembershipRow extends DbRow {
  id: string
  user_id: string
  organization_id: string
  tenant_id: string
  role: string
  status: string
  created_at: Date
}

function mapRow(r: MembershipRow): Membership {
  return {
    id: r.id,
    userId: r.user_id,
    organizationId: r.organization_id,
    role: r.role as Role,
    status: r.status as Membership['status'],
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }
}

export class MembershipRepository {
  constructor(private readonly db: DbClient) {}

  async create(m: Membership): Promise<Membership> {
    const rows = await this.db.queryReturning<MembershipRow>(
      `INSERT INTO memberships (id, user_id, organization_id, tenant_id, role, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [m.id, m.userId, m.organizationId, m.organizationId, m.role, m.status, m.createdAt],
    )
    return mapRow(rows[0]!)
  }

  /**
   * Get a membership by id, ENFORCING tenant scope.
   * Cross-tenant lookup returns null (not found). (Phase 1 section 7/21.)
   */
  async getById(id: string, tenantId: string): Promise<Membership | null> {
    const rows = await this.db.query<MembershipRow>(
      `SELECT * FROM memberships WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  /**
   * Get a user's membership in a specific tenant. Used to resolve
   * TenantContext from the authenticated session. (Phase 1 section 6.)
   */
  async getForUserInTenant(userId: string, tenantId: string): Promise<Membership | null> {
    const rows = await this.db.query<MembershipRow>(
      `SELECT * FROM memberships WHERE user_id = $1 AND organization_id = $2 AND tenant_id = $2 AND status = 'active'`,
      [userId, tenantId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  /**
   * List all memberships in a tenant (ENFORCING tenant scope).
   */
  async listForTenant(tenantId: string): Promise<Membership[]> {
    const rows = await this.db.query<MembershipRow>(
      `SELECT * FROM memberships WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at`,
      [tenantId],
    )
    return rows.map(mapRow)
  }

  /**
   * List all tenants a user belongs to (NOT tenant-scoped — used to resolve
   * which tenants an authenticated user may access). Returns active memberships.
   */
  async listTenantsForUser(userId: string): Promise<Membership[]> {
    const rows = await this.db.query<MembershipRow>(
      `SELECT * FROM memberships WHERE user_id = $1 AND status = 'active' ORDER BY created_at`,
      [userId],
    )
    return rows.map(mapRow)
  }

  /**
   * Revoke a membership (soft-delete via status). Enforces tenant scope.
   */
  async revoke(id: string, tenantId: string): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE memberships SET status = 'revoked' WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [id, tenantId],
    )
    return result.affectedRows > 0
  }
}
