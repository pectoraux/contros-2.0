/**
 * BOQService — application service for scope structure.
 *
 * Owns: authorization, tenant validation, project existence, audit.
 * BOQ is mutable working state — changes do NOT affect finalized
 * EstimateRevision. (Phase 2B.2 §7, §8.)
 */

import type { BOQRepository, ProjectRepository, AuditRepository } from '../persistence/index.js'
import type { TenantContext } from '../domain/types.js'
import type { BOQ, BOQItem } from '../domain/commercial/boq.js'
import { requirePermission, actorIdOf } from '../domain/tenant-context.js'
import { NotFoundError, ValidationError } from '../domain/errors.js'
import { ID_PREFIX, entityId } from '../domain/ids.js'
import { boqItem } from '../domain/commercial/boq.js'
import { quantity } from '../domain/commercial/quantity.js'

export class BOQService {
  constructor(
    private readonly boqs: BOQRepository,
    private readonly projects: ProjectRepository,
    private readonly audit: AuditRepository,
  ) {}

  async createBOQ(ctx: TenantContext, projectId: string, name?: string): Promise<BOQ> {
    requirePermission(ctx, 'boq:write')
    const project = await this.projects.getById(projectId, ctx.tenantId)
    if (!project) throw new NotFoundError('project', projectId)
    const boqId = entityId(ID_PREFIX.workspace)
    const created = await this.boqs.create(boqId, ctx.tenantId, projectId, name)
    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit), tenantId: ctx.tenantId,
      actorId: actorIdOf(ctx), actorKind: ctx.actor.kind, timestamp: new Date().toISOString(),
      action: 'boq.created', entityType: 'boq', entityId: boqId,
      operation: 'create', metadata: { projectId, name: name ?? null },
    })
    return created
  }

  async getBOQ(ctx: TenantContext, boqId: string): Promise<BOQ> {
    requirePermission(ctx, 'boq:read')
    const boq = await this.boqs.getById(boqId, ctx.tenantId)
    if (!boq) throw new NotFoundError('boq', boqId)
    return boq
  }

  async listBOQs(ctx: TenantContext, projectId: string): Promise<BOQ[]> {
    requirePermission(ctx, 'boq:read')
    return this.boqs.listForProject(ctx.tenantId, projectId)
  }

  async addBOQItem(ctx: TenantContext, boqId: string, input: {
    itemCode: string
    description: string
    unit: string
    quantityValue: number
    quantityUnit: string
    provenance: 'plan-measurement' | 'imported' | 'manual'
    sourceMeasurementIds?: string[]
  }): Promise<BOQItem> {
    requirePermission(ctx, 'boq:write')
    // Verify BOQ exists in this tenant
    const boq = await this.boqs.getById(boqId, ctx.tenantId)
    if (!boq) throw new NotFoundError('boq', boqId)
    const item = boqItem({
      itemId: entityId(ID_PREFIX.project),
      itemCode: input.itemCode, description: input.description, unit: input.unit,
      quantity: quantity(input.quantityValue, input.quantityUnit),
      provenance: input.provenance,
      sourceMeasurementIds: input.sourceMeasurementIds ?? [],
    })
    const created = await this.boqs.addItem(item, boqId, ctx.tenantId)
    await this.audit.append({
      eventId: entityId(ID_PREFIX.audit), tenantId: ctx.tenantId,
      actorId: actorIdOf(ctx), actorKind: ctx.actor.kind, timestamp: new Date().toISOString(),
      action: 'boq.item_added', entityType: 'boq_item', entityId: created.itemId,
      operation: 'create', metadata: { boqId, itemCode: input.itemCode },
    })
    return created
  }

  async updateBOQItemQuantity(ctx: TenantContext, itemId: string, quantityValue: number, quantityUnit: string): Promise<boolean> {
    requirePermission(ctx, 'boq:write')
    const item = await this.boqs.getItem(itemId, ctx.tenantId)
    if (!item) throw new NotFoundError('boq_item', itemId)
    const updated = await this.boqs.updateItemQuantity(itemId, ctx.tenantId, quantityValue, quantityUnit)
    if (updated) {
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit), tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx), actorKind: ctx.actor.kind, timestamp: new Date().toISOString(),
        action: 'boq.item_quantity_updated', entityType: 'boq_item', entityId: itemId,
        operation: 'update', metadata: { quantityValue, quantityUnit },
      })
    }
    return updated
  }

  async getBOQItems(ctx: TenantContext, boqId: string): Promise<BOQItem[]> {
    requirePermission(ctx, 'boq:read')
    return this.boqs.listItems(boqId, ctx.tenantId)
  }
}
