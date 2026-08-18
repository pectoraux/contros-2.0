/**
 * Project service — ONE canonical Project identity, tenant-scoped.
 *
 * Project belongs to: Tenant -> Workspace -> Project.
 * Referenced by future domain authorities. No separate OfficeProject/
 * ProgrammeProject/BIMProject. (Phase 1 section 8.)
 *
 * Every operation enforces tenant scope. Cross-tenant lookup resolves
 * as not-found (existence not leaked). (Phase 1 section 7/21.)
 */

import type { ProjectRepository, WorkspaceRepository, AuditRepository } from '../persistence/index.js'
import type { Project, TenantContext } from '../domain/types.js'
import { ID_PREFIX, entityId } from '../domain/ids.js'
import { requirePermission, actorIdOf } from '../domain/tenant-context.js'
import { NotFoundError, ValidationError } from '../domain/errors.js'

export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly audit: AuditRepository,
  ) {}

  async createProject(ctx: TenantContext, workspaceId: string, name: string): Promise<Project> {
    requirePermission(ctx, 'project:write')
    // Verify the workspace exists IN THIS TENANT (tenant-scoped check)
    const ws = await this.workspaces.getById(workspaceId, ctx.tenantId)
    if (!ws) throw new ValidationError(`Workspace not found in this tenant: ${workspaceId}`)

    const now = new Date().toISOString()
    const project = await this.projects.create({
      id: entityId(ID_PREFIX.project),
      tenantId: ctx.tenantId,
      workspaceId,
      name,
      status: 'active',
      createdAt: now,
    })
    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: ctx.tenantId,
      actorId: actorIdOf(ctx),
      actorKind: ctx.actor.kind,
      timestamp: now,
      action: 'project.created',
      entityType: 'project',
      entityId: project.id,
      operation: 'create',
      metadata: { name, workspaceId },
    })
    return project
  }

  /**
   * Get a project by id, ENFORCING tenant scope.
   * Cross-tenant lookup throws NotFound (existence not leaked). (Phase 1 §21.)
   */
  async getProject(ctx: TenantContext, projectId: string): Promise<Project> {
    requirePermission(ctx, 'project:read')
    const project = await this.projects.getById(projectId, ctx.tenantId)
    if (!project) throw new NotFoundError('project', projectId)
    return project
  }

  async listProjectsForWorkspace(ctx: TenantContext, workspaceId: string): Promise<Project[]> {
    requirePermission(ctx, 'project:read')
    return this.projects.listForWorkspace(workspaceId, ctx.tenantId)
  }

  async listProjectsForTenant(ctx: TenantContext): Promise<Project[]> {
    requirePermission(ctx, 'project:read')
    return this.projects.listForTenant(ctx.tenantId)
  }

  async archiveProject(ctx: TenantContext, projectId: string): Promise<boolean> {
    requirePermission(ctx, 'project:write')
    const project = await this.projects.getById(projectId, ctx.tenantId)
    if (!project) throw new NotFoundError('project', projectId)
    const archived = await this.projects.archive(projectId, ctx.tenantId)
    if (archived) {
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit),
        tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx),
        actorKind: ctx.actor.kind,
        timestamp: new Date().toISOString(),
        action: 'project.archived',
        entityType: 'project',
        entityId: projectId,
        operation: 'archive',
        metadata: null,
      })
    }
    return archived
  }
}
