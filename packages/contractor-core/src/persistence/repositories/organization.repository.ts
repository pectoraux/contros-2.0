/**
 * Organization repository — tenant-scoped.
 *
 * An Organization IS the tenant (tenant_id == organization id).
 * Every query enforces tenant scope. (Phase 1 section 7.)
 */

import type { DbClient, DbRow } from '../db-client.js'
import type { Organization } from '../../domain/types.js'

interface OrganizationRow extends DbRow {
  id: string
  tenant_id: string
  name: string
  slug: string
  status: string
  created_at: Date
}

function mapRow(r: OrganizationRow): Organization {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    slug: r.slug,
    status: r.status as Organization['status'],
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }
}

export class OrganizationRepository {
  constructor(private readonly db: DbClient) {}

  async create(org: Organization): Promise<Organization> {
    const rows = await this.db.queryReturning<OrganizationRow>(
      `INSERT INTO organizations (id, tenant_id, name, slug, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [org.id, org.tenantId, org.name, org.slug, org.status, org.createdAt],
    )
    return mapRow(rows[0]!)
  }

  /**
   * Get an organization by id, ENFORCING tenant scope.
   * A request from tenant A for an org in tenant B returns null (not found),
   * NOT the other tenant's data. (Phase 1 section 7/21.)
   */
  async getById(id: string, tenantId: string): Promise<Organization | null> {
    const rows = await this.db.query<OrganizationRow>(
      `SELECT * FROM organizations WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  /**
   * Get an organization by slug (globally unique). Used for lookup before
   * tenant context is established (e.g. login flow). Tenant scope is NOT
   * applied here because the org IS the tenant.
   */
  async getBySlug(slug: string): Promise<Organization | null> {
    const rows = await this.db.query<OrganizationRow>(
      `SELECT * FROM organizations WHERE slug = $1`,
      [slug],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  /**
   * List organizations for a tenant (typically just the tenant itself,
   * but the query still enforces scope).
   */
  async listForTenant(tenantId: string): Promise<Organization[]> {
    const rows = await this.db.query<OrganizationRow>(
      `SELECT * FROM organizations WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    )
    return rows.map(mapRow)
  }
}
