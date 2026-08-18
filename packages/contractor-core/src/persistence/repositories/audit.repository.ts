/**
 * AuditEvent repository — tenant-scoped, APPEND-ONLY.
 *
 * NO update or delete methods are exposed. The database has triggers that
 * block UPDATE/DELETE as defense in depth. (Phase 1 section 12;
 * ADR-0005 Decision 6.)
 *
 * Audit identity is SEPARATE from content integrity hash. (master prompt §15.)
 */

import type { DbClient, DbRow } from '../db-client.js'
import type { AuditEvent } from '../../domain/types.js'

interface AuditRow extends DbRow {
  event_id: string
  tenant_id: string
  actor_id: string
  actor_kind: string
  timestamp: Date
  action: string
  entity_type: string
  entity_id: string
  operation: string
  metadata: string | null
}

function mapRow(r: AuditRow): AuditEvent {
  return {
    eventId: r.event_id,
    tenantId: r.tenant_id,
    actorId: r.actor_id,
    actorKind: r.actor_kind as AuditEvent['actorKind'],
    timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    operation: r.operation,
    // pglite/pg parse JSONB columns into objects already; handle both.
    metadata: r.metadata
      ? (typeof r.metadata === 'string' ? (JSON.parse(r.metadata) as Record<string, unknown>) : (r.metadata as Record<string, unknown>))
      : null,
  }
}

export class AuditRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * Append an audit event. This is the ONLY write method.
   * There are NO update or delete methods. (Phase 1 section 12/14.)
   */
  async append(e: AuditEvent): Promise<AuditEvent> {
    const rows = await this.db.queryReturning<AuditRow>(
      `INSERT INTO audit_events (event_id, tenant_id, actor_id, actor_kind, timestamp, action, entity_type, entity_id, operation, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        e.eventId,
        e.tenantId,
        e.actorId,
        e.actorKind,
        e.timestamp,
        e.action,
        e.entityType,
        e.entityId,
        e.operation,
        e.metadata ? JSON.stringify(e.metadata) : null,
      ],
    )
    return mapRow(rows[0]!)
  }

  /**
   * List audit events for a tenant, ENFORCING tenant scope.
   * Cross-tenant query returns nothing. (Phase 1 section 7/21.)
   */
  async listForTenant(tenantId: string, limit = 100): Promise<AuditEvent[]> {
    const rows = await this.db.query<AuditRow>(
      `SELECT * FROM audit_events WHERE tenant_id = $1 ORDER BY timestamp DESC LIMIT $2`,
      [tenantId, limit],
    )
    return rows.map(mapRow)
  }

  /**
   * List audit events for a specific entity, ENFORCING tenant scope.
   */
  async listForEntity(
    tenantId: string,
    entityType: string,
    entityId: string,
    limit = 100,
  ): Promise<AuditEvent[]> {
    const rows = await this.db.query<AuditRow>(
      `SELECT * FROM audit_events WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3 ORDER BY timestamp DESC LIMIT $4`,
      [tenantId, entityType, entityId, limit],
    )
    return rows.map(mapRow)
  }

  // NOTE: There are intentionally NO update() or delete() methods.
  // Audit history is append-only. The database enforces this via triggers.
  // (Phase 1 section 14 — immutability rule.)
}
