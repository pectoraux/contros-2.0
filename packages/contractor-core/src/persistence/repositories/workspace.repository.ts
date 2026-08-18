/**
 * Workspace repository — tenant-scoped.
 *
 * A Workspace is an organizational container inside a Tenant, owning Projects.
 * Every query enforces tenant scope. (Phase 1 section 7/10.)
 */

import type { DbClient, DbRow } from '../db-client.js'
import type { Workspace } from '../../domain/types.js'

interface WorkspaceRow extends DbRow {
  id: string
  tenant_id: string
  organization_id: string
  name: string
  created_at: Date
}

function mapRow(r: WorkspaceRow): Workspace {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    organizationId: r.organization_id,
    name: r.name,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }
}

export class WorkspaceRepository {
  constructor(private readonly db: DbClient) {}

  async create(ws: Workspace): Promise<Workspace> {
    const rows = await this.db.queryReturning<WorkspaceRow>(
      `INSERT INTO workspaces (id, tenant_id, organization_id, name, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [ws.id, ws.tenantId, ws.organizationId, ws.name, ws.createdAt],
    )
    return mapRow(rows[0]!)
  }

  /**
   * Get a workspace by id, ENFORCING tenant scope.
   * Cross-tenant lookup returns null. (Phase 1 section 7/21.)
   */
  async getById(id: string, tenantId: string): Promise<Workspace | null> {
    const rows = await this.db.query<WorkspaceRow>(
      `SELECT * FROM workspaces WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  async listForTenant(tenantId: string): Promise<Workspace[]> {
    const rows = await this.db.query<WorkspaceRow>(
      `SELECT * FROM workspaces WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    )
    return rows.map(mapRow)
  }
}
