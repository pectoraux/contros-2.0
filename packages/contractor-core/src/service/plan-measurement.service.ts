/**
 * PlanMeasurementService — application service for measurement evidence.
 *
 * Owns: authorization, tenant validation, project existence, actor attribution,
 * audit emission. Does NOT introduce pricing. Measurement evidence does not
 * mutate EstimateRevision. (Phase 2B.2 §6.)
 *
 * Phase 2B.2.1: mutations + audit events are atomic. (H1 fix.)
 */

import type { DbClient } from '../persistence/db-client.js'
import type { PlanMeasurementRepository, ProjectRepository, AuditRepository } from '../persistence/index.js'
import type { TenantContext } from '../domain/types.js'
import type { PlanMeasurement as PM } from '../domain/commercial/plan-measurement.js'
import { requirePermission, actorIdOf } from '../domain/tenant-context.js'
import { NotFoundError } from '../domain/errors.js'
import { ID_PREFIX, entityId } from '../domain/ids.js'
import { planMeasurement } from '../domain/commercial/plan-measurement.js'

export class PlanMeasurementService {
  constructor(
    private readonly db: DbClient,
    private readonly measurements: PlanMeasurementRepository,
    private readonly projects: ProjectRepository,
    private readonly audit: AuditRepository,
  ) {}

  async createMeasurement(
    ctx: TenantContext,
    projectId: string,
    input: {
      sourceArtifactId: string
      sourceArtifactHash: string
      sheetId: string | null
      sheetRevision: string | null
      elementReference: string
      quantityValue: number
      quantityUnit: string
      measurementMethod: 'manual-takeoff' | 'auto-takeoff' | 'ai-proposed' | 'imported'
      measurementBasis: 'count' | 'length' | 'area' | 'volume' | 'mass' | 'time'
      measurementEngineVersion: string
    },
  ): Promise<PM> {
    requirePermission(ctx, 'plan:write')
    const project = await this.projects.getById(projectId, ctx.tenantId)
    if (!project) throw new NotFoundError('project', projectId)

    const { quantityValue, quantityUnit, ...rest } = input
    const pm = planMeasurement({
      measurementId: entityId(ID_PREFIX.audit),
      quantity: { __brand: 'Quantity', value: quantityValue, unit: quantityUnit } as PM['quantity'],
      actorId: actorIdOf(ctx),
      measuredAt: new Date().toISOString(),
      provisional: false,
      ...rest,
    })
    return this.db.tx(async () => {
      const created = await this.measurements.create(pm, ctx.tenantId, projectId)
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit), tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx), actorKind: ctx.actor.kind, timestamp: new Date().toISOString(),
        action: 'plan.measurement_created', entityType: 'plan_measurement', entityId: created.measurementId,
        operation: 'create', metadata: { projectId, elementReference: input.elementReference },
      })
      return created
    })
  }

  async getMeasurement(ctx: TenantContext, measurementId: string): Promise<PM> {
    requirePermission(ctx, 'plan:read')
    const pm = await this.measurements.getById(measurementId, ctx.tenantId)
    if (!pm) throw new NotFoundError('plan_measurement', measurementId)
    return pm
  }

  async listMeasurements(ctx: TenantContext, projectId: string): Promise<PM[]> {
    requirePermission(ctx, 'plan:read')
    return this.measurements.listForProject(ctx.tenantId, projectId)
  }
}
