/**
 * BidService — application service for commercial submission decisions.
 *
 * Owns: authorization, tenant validation, cross-entity validation
 * (Bid → EstimateRevision same tenant + same project + finalized),
 * content hash verification, workflow, audit. (Phase 2B.2 §16-§21.)
 *
 * Phase 2B.2.1: authority-changing operations + audit events are atomic.
 * Bid.submittedAt is populated atomically with status=submitted + audit.
 *
 * Bid.finalPrice is an explicit commercial decision — NOT derived from
 * EstimateRevision.sellPrice. The service preserves the deliberate ability
 * for Bid.finalPrice ≠ EstimateRevision.sellPrice.
 */

import type { DbClient } from '../persistence/db-client.js'
import type { BidRepository, EstimateRevisionRepository, AuditRepository } from '../persistence/index.js'
import type { TenantContext } from '../domain/types.js'
import type { Bid, BidStatus } from '../domain/commercial/bid.js'
import type { Money } from '../domain/commercial/money.js'
import { validateBidSubmission, bid as createBidValue } from '../domain/commercial/bid.js'
import { estimateRevisionContentHash } from '../domain/commercial/estimate-revision.js'
import { requirePermission, actorIdOf } from '../domain/tenant-context.js'
import { NotFoundError, ValidationError, ConflictError } from '../domain/errors.js'
import { ID_PREFIX, entityId } from '../domain/ids.js'

// Terminal states — cannot transition back to draft
const TERMINAL_STATUSES: ReadonlySet<BidStatus> = new Set(['won', 'lost', 'withdrawn'])

export class BidService {
  constructor(
    private readonly db: DbClient,
    private readonly bids: BidRepository,
    private readonly estimates: EstimateRevisionRepository,
    private readonly audit: AuditRepository,
  ) {}

  async createBid(
    ctx: TenantContext,
    projectId: string,
    estimateRevisionId: string,
    finalPrice: Money | null,
    directorAdjustment: Money | null = null,
    adjustmentRationale: string | null = null,
  ): Promise<Bid> {
    requirePermission(ctx, 'bid:write')
    // §17: Cross-entity validation — load the referenced revision (before transaction)
    const revision = await this.estimates.getById(estimateRevisionId, ctx.tenantId)
    if (!revision) {
      throw new NotFoundError('revision', estimateRevisionId)
    }
    // Verify same project
    if (revision.metadata.projectId !== projectId) {
      throw new ValidationError(
        `Bid project (${projectId}) does not match estimate revision project (${revision.metadata.projectId})`,
      )
    }
    // A draft Bid may reference a draft EstimateRevision (Phase 2B.2.1 §17 decision).
    // Submission requires finalized — checked in submitBid.
    // §18: Bid hash — compute from actual revision (not client-supplied)
    const actualHash = estimateRevisionContentHash(revision.payload)
    const b = createBidValue({
      bidId: entityId(ID_PREFIX.audit),
      projectId,
      estimateRevisionId,
      estimateRevisionContentHash: actualHash,
      status: 'draft',
      finalPrice,
      directorAdjustment,
      adjustmentRationale,
    })
    // Atomic: bid insert + audit in one transaction
    return this.db.tx(async () => {
      const created = await this.bids.create(b, ctx.tenantId)
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit), tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx), actorKind: ctx.actor.kind, timestamp: new Date().toISOString(),
        action: 'bid.created', entityType: 'bid', entityId: created.bidId,
        operation: 'create', metadata: { projectId, estimateRevisionId },
      })
      return created
    })
  }

  async getBid(ctx: TenantContext, bidId: string): Promise<Bid> {
    requirePermission(ctx, 'bid:read')
    const b = await this.bids.getById(bidId, ctx.tenantId)
    if (!b) throw new NotFoundError('bid', bidId)
    return b
  }

  async listBids(ctx: TenantContext, projectId: string): Promise<Bid[]> {
    requirePermission(ctx, 'bid:read')
    return this.bids.listForProject(ctx.tenantId, projectId)
  }

  async submitBid(ctx: TenantContext, bidId: string): Promise<Bid> {
    requirePermission(ctx, 'bid:submit')
    // Load and validate (before transaction)
    const bid = await this.bids.getById(bidId, ctx.tenantId)
    if (!bid) throw new NotFoundError('bid', bidId)
    if (bid.status !== 'draft') {
      throw new ConflictError(`Cannot submit bid ${bidId}: status is ${bid.status} (only draft can be submitted)`)
    }
    // Load the referenced revision and verify it's finalized
    const revision = await this.estimates.getById(bid.estimateRevisionId, ctx.tenantId)
    if (!revision) {
      throw new NotFoundError('revision', bid.estimateRevisionId)
    }
    // §18: Verify content hash still matches
    const actualHash = estimateRevisionContentHash(revision.payload)
    if (bid.estimateRevisionContentHash !== actualHash) {
      throw new ConflictError(
        `Bid content hash (${bid.estimateRevisionContentHash}) does not match the revision's actual hash (${actualHash})`,
        { bidId, storedHash: bid.estimateRevisionContentHash, actualHash },
      )
    }
    // Run domain validation
    const validation = validateBidSubmission(bid, revision)
    if (!validation.ok) {
      throw new ValidationError(`Bid submission validation failed: ${validation.errors.join('; ')}`)
    }
    // Atomic: status=submitted + submittedAt + audit in one transaction
    const submittedAt = new Date().toISOString()
    return this.db.tx(async () => {
      const updated = await this.bids.submit(bidId, ctx.tenantId, submittedAt)
      if (!updated) throw new NotFoundError('bid', bidId)
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit), tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx), actorKind: ctx.actor.kind, timestamp: submittedAt,
        action: 'bid.submitted', entityType: 'bid', entityId: bidId,
        operation: 'submit', metadata: { estimateRevisionId: bid.estimateRevisionId },
      })
      return updated
    })
  }

  async recordBidOutcome(ctx: TenantContext, bidId: string, outcome: 'won' | 'lost', note?: string): Promise<Bid> {
    requirePermission(ctx, 'bid:submit')
    // Load and validate (before transaction)
    const bid = await this.bids.getById(bidId, ctx.tenantId)
    if (!bid) throw new NotFoundError('bid', bidId)
    if (bid.status !== 'submitted') {
      throw new ConflictError(`Cannot record outcome for bid ${bidId}: status is ${bid.status} (only submitted bids can have outcomes)`)
    }
    if (TERMINAL_STATUSES.has(bid.status)) {
      throw new ConflictError(`Cannot record outcome for bid ${bidId}: status ${bid.status} is terminal`)
    }
    // Atomic: status + outcomeAt + audit in one transaction
    const outcomeAt = new Date().toISOString()
    return this.db.tx(async () => {
      const updated = await this.bids.recordOutcome(bidId, ctx.tenantId, outcome, outcomeAt, note)
      if (!updated) throw new NotFoundError('bid', bidId)
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit), tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx), actorKind: ctx.actor.kind, timestamp: outcomeAt,
        action: `bid.${outcome}`, entityType: 'bid', entityId: bidId,
        operation: outcome, metadata: { note: note ?? null },
      })
      return updated
    })
  }

  async withdrawBid(ctx: TenantContext, bidId: string): Promise<Bid> {
    requirePermission(ctx, 'bid:submit')
    // Load and validate (before transaction)
    const bid = await this.bids.getById(bidId, ctx.tenantId)
    if (!bid) throw new NotFoundError('bid', bidId)
    if (TERMINAL_STATUSES.has(bid.status)) {
      throw new ConflictError(`Cannot withdraw bid ${bidId}: status ${bid.status} is terminal`)
    }
    // Atomic: status=withdrawn + audit in one transaction
    return this.db.tx(async () => {
      const updated = await this.bids.updateStatus(bidId, ctx.tenantId, 'withdrawn')
      if (!updated) throw new NotFoundError('bid', bidId)
      await this.audit.append({
        eventId: entityId(ID_PREFIX.audit), tenantId: ctx.tenantId,
        actorId: actorIdOf(ctx), actorKind: ctx.actor.kind, timestamp: new Date().toISOString(),
        action: 'bid.withdrawn', entityType: 'bid', entityId: bidId,
        operation: 'withdraw', metadata: null,
      })
      return updated
    })
  }
}
