/**
 * EstimateService — the central Commercial application service.
 *
 * Owns: authorization, tenant validation, project existence, cross-entity
 * validation, transaction orchestration, audit emission, workflow.
 * Delegates pricing mathematics to the domain layer. Delegates persistence
 * to the EstimateRevisionRepository. (Phase 2B.2 §9-§15.)
 *
 * Phase 2B.2.1: authority-changing operations + audit events are atomic.
 * The service wraps both writes in db.tx(). Repositories use this.db
 * (the same DbClient instance), so their internal queries participate in
 * the outer transaction. (H1 fix.)
 *
 * EstimateRevision = canonical commercial authority. The service ensures:
 *   - createDraft: payload + hash + revision + audit are atomically persisted
 *   - updateDraft: only draft revisions can be updated; payload + hash + audit atomic
 *   - finalize: hash verification before finalization; finalize + audit atomic
 *   - supersede: only finalized → superseded; supersede + audit atomic
 *   - replay: load → reconstruct → verify hash → compute totals
 */

import type { DbClient } from '../persistence/db-client.js'
import type { EstimateRevisionRepository, ProjectRepository, AuditRepository } from '../persistence/index.js'
import type { TenantContext } from '../domain/types.js'
import type { EstimateRevision, EstimateRevisionPayload, EstimateRevisionTotals } from '../domain/commercial/estimate-revision.js'
import { estimateRevisionContentHash, computeEstimateRevisionTotals, replayEstimateRevision } from '../domain/commercial/estimate-revision.js'
import { requirePermission, actorIdOf } from '../domain/tenant-context.js'
import { NotFoundError, ValidationError, ConflictError } from '../domain/errors.js'
import { ID_PREFIX, entityId } from '../domain/ids.js'

export interface EstimateReplayResult {
  readonly contentHashMatches: boolean
  readonly storedHash: string
  readonly calculatedHash: string
  readonly totals: EstimateRevisionTotals
}

export class EstimateService {
  constructor(
    private readonly db: DbClient,
    private readonly estimates: EstimateRevisionRepository,
    private readonly projects: ProjectRepository,
    private readonly audit: AuditRepository,
  ) {}

  async createEstimateDraft(
    ctx: TenantContext,
    projectId: string,
    payload: EstimateRevisionPayload,
  ): Promise<EstimateRevision> {
    requirePermission(ctx, 'estimate:write')
    // Verify project exists in this tenant (before transaction)
    const project = await this.projects.getById(projectId, ctx.tenantId)
    if (!project) throw new NotFoundError('project', projectId)
    // Verify payload project matches
    if (payload.projectId !== projectId) {
      throw new ValidationError(`Payload projectId (${payload.projectId}) does not match the requested project (${projectId})`)
    }
    // Atomic: revision + payload + audit in one transaction
    return this.db.tx(async () => {
      const created = await this.estimates.createDraft(
        ctx.tenantId, projectId, payload,
        actorIdOf(ctx), new Date().toISOString(),
      )
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit), tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx), actorKind: ctx.actor.kind, timestamp: new Date().toISOString(),
        action: 'estimate.draft_created', entityType: 'revision', entityId: created.metadata.revisionId,
        operation: 'create_draft', metadata: { projectId, revisionNumber: created.metadata.revisionNumber },
      })
      return created
    })
  }

  async getEstimateRevision(ctx: TenantContext, revisionId: string): Promise<EstimateRevision> {
    requirePermission(ctx, 'estimate:read')
    const rev = await this.estimates.getById(revisionId, ctx.tenantId)
    if (!rev) throw new NotFoundError('revision', revisionId)
    return rev
  }

  async listEstimateRevisions(ctx: TenantContext, projectId: string): Promise<EstimateRevision[]> {
    requirePermission(ctx, 'estimate:read')
    return this.estimates.listForProject(ctx.tenantId, projectId)
  }

  async updateEstimateDraft(
    ctx: TenantContext,
    revisionId: string,
    payload: EstimateRevisionPayload,
  ): Promise<EstimateRevision> {
    requirePermission(ctx, 'estimate:write')
    // Load and verify it's a draft (before transaction)
    const existing = await this.estimates.getById(revisionId, ctx.tenantId)
    if (!existing) throw new NotFoundError('revision', revisionId)
    if (existing.metadata.status !== 'draft') {
      throw new ConflictError(`Cannot update revision ${revisionId}: status is ${existing.metadata.status} (only draft can be updated)`)
    }
    // Verify payload project matches the revision's project
    if (payload.projectId !== existing.metadata.projectId) {
      throw new ValidationError(`Payload projectId (${payload.projectId}) does not match the revision's project (${existing.metadata.projectId})`)
    }
    // Atomic: payload + hash + audit in one transaction
    return this.db.tx(async () => {
      const updated = await this.estimates.updateDraftPayload(revisionId, ctx.tenantId, payload)
      if (!updated) throw new NotFoundError('revision', revisionId)
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit), tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx), actorKind: ctx.actor.kind, timestamp: new Date().toISOString(),
        action: 'estimate.draft_updated', entityType: 'revision', entityId: revisionId,
        operation: 'update_draft', metadata: { contentHash: updated.metadata.contentHash },
      })
      return updated
    })
  }

  async finalizeEstimate(ctx: TenantContext, revisionId: string): Promise<EstimateRevision> {
    requirePermission(ctx, 'estimate:finalize')
    // Load and validate (before transaction)
    const existing = await this.estimates.getById(revisionId, ctx.tenantId)
    if (!existing) throw new NotFoundError('revision', revisionId)
    if (existing.metadata.status !== 'draft') {
      throw new ConflictError(`Cannot finalize revision ${revisionId}: status is ${existing.metadata.status}`)
    }
    // §13: Finalization replay check — verify stored hash matches recomputed hash
    const calculatedHash = estimateRevisionContentHash(existing.payload)
    if (calculatedHash !== existing.metadata.contentHash) {
      throw new ConflictError(
        `Cannot finalize revision ${revisionId}: stored content hash (${existing.metadata.contentHash}) does not match recalculated hash (${calculatedHash})`,
        { revisionId, storedHash: existing.metadata.contentHash, calculatedHash },
      )
    }
    // Atomic: finalize + audit in one transaction
    return this.db.tx(async () => {
      const finalized = await this.estimates.finalize(revisionId, ctx.tenantId, new Date().toISOString())
      if (!finalized) throw new NotFoundError('revision', revisionId)
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit), tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx), actorKind: ctx.actor.kind, timestamp: new Date().toISOString(),
        action: 'estimate.finalized', entityType: 'revision', entityId: revisionId,
        operation: 'finalize', metadata: { contentHash: finalized.metadata.contentHash },
      })
      return finalized
    })
  }

  async supersedeEstimate(ctx: TenantContext, revisionId: string): Promise<EstimateRevision> {
    requirePermission(ctx, 'estimate:finalize')
    // Load and validate (before transaction)
    const existing = await this.estimates.getById(revisionId, ctx.tenantId)
    if (!existing) throw new NotFoundError('revision', revisionId)
    if (existing.metadata.status !== 'finalized') {
      throw new ConflictError(`Cannot supersede revision ${revisionId}: status is ${existing.metadata.status} (only finalized can be superseded)`)
    }
    // Atomic: supersede + audit in one transaction
    return this.db.tx(async () => {
      const superseded = await this.estimates.supersede(revisionId, ctx.tenantId)
      if (!superseded) throw new NotFoundError('revision', revisionId)
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit), tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx), actorKind: ctx.actor.kind, timestamp: new Date().toISOString(),
        action: 'estimate.superseded', entityType: 'revision', entityId: revisionId,
        operation: 'supersede', metadata: null,
      })
      return superseded
    })
  }

  async replayEstimate(ctx: TenantContext, revisionId: string): Promise<EstimateReplayResult> {
    requirePermission(ctx, 'estimate:read')
    const rev = await this.estimates.getById(revisionId, ctx.tenantId)
    if (!rev) throw new NotFoundError('revision', revisionId)
    const calculatedHash = estimateRevisionContentHash(rev.payload)
    const totals = replayEstimateRevision(rev)
    return {
      contentHashMatches: calculatedHash === rev.metadata.contentHash,
      storedHash: rev.metadata.contentHash,
      calculatedHash,
      totals,
    }
  }
}
