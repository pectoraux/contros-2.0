/**
 * Audit service — append-only audit event recording + tenant-scoped reads.
 *
 * Audit is infrastructure used by all later domains. Audit identity is
 * SEPARATE from content integrity hash. (Phase 1 section 12; master §15.)
 */

import type { AuditRepository } from '../persistence/index.js'
import type { AuditEvent, TenantContext } from '../domain/types.js'
import { ID_PREFIX, entityId } from '../domain/ids.js'
import { requirePermission, actorIdOf } from '../domain/tenant-context.js'

export class AuditService {
  constructor(private readonly audit: AuditRepository) {}

  /**
   * Record an audit event. Tenant-scoped, append-only.
   * There is NO update or delete — the repository does not expose them.
   */
  async record(
    ctx: TenantContext,
    action: string,
    entityType: string,
    targetEntityId: string,
    operation: string,
    metadata: Record<string, unknown> | null,
  ): Promise<AuditEvent> {
    requirePermission(ctx, 'audit:read') // any tenant member can record audit
    return this.audit.append({
      eventId: entityId(ID_PREFIX.audit),
      tenantId: ctx.tenantId,
      actorId: actorIdOf(ctx),
      actorKind: ctx.actor.kind,
      timestamp: new Date().toISOString(),
      action,
      entityType,
      entityId: targetEntityId,
      operation,
      metadata,
    })
  }

  async listForTenant(ctx: TenantContext, limit = 100): Promise<AuditEvent[]> {
    requirePermission(ctx, 'audit:read')
    return this.audit.listForTenant(ctx.tenantId, limit)
  }

  async listForEntity(
    ctx: TenantContext,
    entityType: string,
    entityId: string,
    limit = 100,
  ): Promise<AuditEvent[]> {
    requirePermission(ctx, 'audit:read')
    return this.audit.listForEntity(ctx.tenantId, entityType, entityId, limit)
  }
}
