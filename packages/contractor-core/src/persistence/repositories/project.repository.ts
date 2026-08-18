/**
 * Project repository — tenant-scoped. ONE canonical Project model.
 *
 * Referenced by future domain authorities via project_id.
 * No OfficeProject/ProgrammeProject/BIMProject etc. (Phase 1 section 8.)
 * Every query enforces tenant scope. (Phase 1 section 7.)
 */

import type { DbClient, DbRow } from '../db-client.js'
import type { Project } from '../../domain/types.js'

interface ProjectRow extends DbRow {
  id: string
  tenant_id: string
  workspace_id: string
  name: string
  status: string
  created_at: Date
}

function mapRow(r: ProjectRow): Project {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    workspaceId: r.workspace_id,
    name: r.name,
    status: r.status as Project['status'],
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }
}

export class ProjectRepository {
  constructor(private readonly db: DbClient) {}

  async create(p: Project): Promise<Project> {
    const rows = await this.db.queryReturning<ProjectRow>(
      `INSERT INTO projects (id, tenant_id, workspace_id, name, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [p.id, p.tenantId, p.workspaceId, p.name, p.status, p.createdAt],
    )
    return mapRow(rows[0]!)
  }

  /**
   * Get a project by id, ENFORCING tenant scope.
   * Cross-tenant lookup returns null (not found), NOT the other tenant's
   * data. (Phase 1 section 7/21.)
   *
   * This is the canonical Project identity lookup. All future domain
   * authorities resolve their project via this (or an equivalent
   * tenant-scoped query).
   */
  async getById(id: string, tenantId: string): Promise<Project | null> {
    const rows = await this.db.query<ProjectRow>(
      `SELECT * FROM projects WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  }

  async listForWorkspace(workspaceId: string, tenantId: string): Promise<Project[]> {
    const rows = await this.db.query<ProjectRow>(
      `SELECT * FROM projects WHERE workspace_id = $1 AND tenant_id = $2 ORDER BY created_at`,
      [workspaceId, tenantId],
    )
    return rows.map(mapRow)
  }

  async listForTenant(tenantId: string): Promise<Project[]> {
    const rows = await this.db.query<ProjectRow>(
      `SELECT * FROM projects WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    )
    return rows.map(mapRow)
  }

  async archive(id: string, tenantId: string): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE projects SET status = 'archived' WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [id, tenantId],
    )
    return result.affectedRows > 0
  }
}
