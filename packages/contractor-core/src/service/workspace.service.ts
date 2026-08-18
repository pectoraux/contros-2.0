/**
 * Workspace service — tenant-scoped organizational containers.
 *
 * Every operation enforces tenant scope via the TenantContext + repository.
 * Authorization is checked before any mutation. (Phase 1 section 10/18.)
 */

import type { WorkspaceRepository, AuditRepository } from '../persistence/index.js'
import type { Workspace, TenantContext } from '../domain/types.js'
import { ID_PREFIX, entityId } from '../domain/ids.js'
import { requirePermission } from '../domain/tenant-context.js'
import { NotFoundError } from '../domain/errors.js'

export class WorkspaceService {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly audit: AuditRepository,
  ) {}

  async createWorkspace(ctx: TenantContext, name: string): Promise<Workspace> {
    requirePermission(ctx, 'workspace:write')
    const now = new Date().toISOString()
    const ws = await this.workspaces.create({
      id: entityId(ID_PREFIX.workspace),
      tenantId: ctx.tenantId,
      organizationId: ctx.tenantId, // workspace's org == the tenant
      name,
      createdAt: now,
    })
    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: ctx.tenantId,
      actorId: ctx.actor.kind === 'user' ? ctx.actor.userId : ctx.actor.serviceId,
      actorKind: ctx.actor.kind,
      timestamp: now,
      action: 'workspace.created',
      entityType: 'workspace',
      entityId: ws.id,
      operation: 'create',
      metadata: { name },
    })
    return ws
  }

  async getWorkspace(ctx: TenantContext, workspaceId: string): Promise<Workspace> {
    requirePermission(ctx, 'workspace:read')
    const ws = await this.workspaces.getById(workspaceId, ctx.tenantId)
    if (!ws) throw new NotFoundError('workspace', workspaceId)
    return ws
  }

  async listWorkspaces(ctx: TenantContext): Promise<Workspace[]> {
    requirePermission(ctx, 'workspace:read')
    return this.workspaces.listForTenant(ctx.tenantId)
  }
}
