/**
 * Commercial application-services integration tests.
 *
 * Run against REAL PostgreSQL (pglite — PostgreSQL 16 WASM). NOT mocked.
 * Covers the 4 Commercial application services (Phase 2B.2 §6-§21):
 *   - PlanMeasurementService (evidence)
 *   - BOQService (scope structure)
 *   - EstimateService (canonical commercial authority — the central service)
 *   - BidService (commercial submission decision)
 *
 * Service-layer concerns verified end-to-end against a real database:
 *   - Authorization (viewer/member/owner/admin permission boundaries)
 *   - Tenant isolation (cross-tenant reads/writes rejected)
 *   - Cross-project validation (same tenant, different project)
 *   - Finalized immutability through the service (ConflictError)
 *   - Hash verification on finalization (defense in depth)
 *   - Bid hash verification on submission (defense in depth)
 *   - Audit emission on every authority-changing operation
 *
 * Each test bootstraps its own tenant (user + org + workspace + project)
 * to keep tests independent. IDs use the standard entityId + ID_PREFIX
 * pattern (matches setup.ts + commercial.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import {
  PgLiteClient,
  FOUNDATION_MIGRATION_SQL,
  COMMERCIAL_MIGRATION_SQL,
  applyMigration,
} from '../../src/persistence/index.js'
import {
  PlanMeasurementRepository,
  BOQRepository,
  EstimateRevisionRepository,
  BidRepository,
  OrganizationRepository,
  UserRepository,
  MembershipRepository,
  WorkspaceRepository,
  ProjectRepository,
  AuditRepository,
} from '../../src/persistence/index.js'
import {
  EstimateService,
  BOQService,
  BidService,
  PlanMeasurementService,
} from '../../src/service/index.js'
import {
  estimateRevisionPayload,
  estimateRevisionContentHash,
  computeEstimateRevisionTotals,
  replayEstimateRevision,
  type EstimateRevision,
  type EstimateRevisionPayload,
} from '../../src/domain/commercial/estimate-revision.js'
import { estimateLine } from '../../src/domain/commercial/estimate-line.js'
import { money, moneyFromMinor } from '../../src/domain/commercial/money.js'
import { quantity, UNITS } from '../../src/domain/commercial/quantity.js'
import { ratio } from '../../src/domain/commercial/pricing.js'
import { currencyCode } from '../../src/domain/commercial/currency.js'
import { entityId, ID_PREFIX } from '../../src/domain/ids.js'
import { createTenantContext } from '../../src/domain/tenant-context.js'
import type { Membership, Role, TenantContext } from '../../src/domain/types.js'
import {
  UnauthorizedError,
  NotFoundError,
  ValidationError,
  ConflictError,
} from '../../src/domain/errors.js'

// ─────────────────────────────────────────────────────────────
// Test harness — single pglite instance, both migrations applied.
// Mirrors the structure of commercial.test.ts but wires up the
// application services rather than the raw repositories.
// ─────────────────────────────────────────────────────────────

let db: PgLiteClient
let repos: {
  pm: PlanMeasurementRepository
  boq: BOQRepository
  estRev: EstimateRevisionRepository
  bids: BidRepository
  orgs: OrganizationRepository
  users: UserRepository
  memberships: MembershipRepository
  workspaces: WorkspaceRepository
  projects: ProjectRepository
  audit: AuditRepository
}
let services: {
  estimates: EstimateService
  boqs: BOQService
  bids: BidService
  measurements: PlanMeasurementService
}

beforeAll(async () => {
  const pg = new PGlite()
  db = new PgLiteClient(pg)
  await applyMigration(db, FOUNDATION_MIGRATION_SQL)
  await applyMigration(db, COMMERCIAL_MIGRATION_SQL)

  repos = {
    pm: new PlanMeasurementRepository(db),
    boq: new BOQRepository(db),
    estRev: new EstimateRevisionRepository(db),
    bids: new BidRepository(db),
    orgs: new OrganizationRepository(db),
    users: new UserRepository(db),
    memberships: new MembershipRepository(db),
    workspaces: new WorkspaceRepository(db),
    projects: new ProjectRepository(db),
    audit: new AuditRepository(db),
  }

  services = {
    estimates: new EstimateService(repos.estRev, repos.projects, repos.audit),
    boqs: new BOQService(repos.boq, repos.projects, repos.audit),
    bids: new BidService(repos.bids, repos.estRev, repos.audit),
    measurements: new PlanMeasurementService(repos.pm, repos.projects, repos.audit),
  }
})

afterAll(async () => {
  await db.close()
})

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Bootstrap a full tenant: user + org + workspace + project + membership.
 * Default role is 'owner' (full commercial authority).
 * Returns the entities + a ready-to-use TenantContext.
 */
async function bootstrap(
  orgName: string,
  role: Role = 'owner',
): Promise<{
  user: { id: string }
  orgId: string
  wsId: string
  projId: string
  ctx: TenantContext
  membership: Membership
}> {
  const uniq = orgName + '_' + Math.random().toString(36).slice(2, 8)
  const user = await repos.users.create({
    id: entityId(ID_PREFIX.user),
    email: uniq + '@test',
    displayName: uniq,
    status: 'active',
    createdAt: new Date().toISOString(),
  })
  const orgId = entityId(ID_PREFIX.organization)
  await repos.orgs.create({
    id: orgId,
    tenantId: orgId,
    name: uniq,
    slug: uniq,
    status: 'active',
    createdAt: new Date().toISOString(),
  })
  const membership: Membership = {
    id: entityId(ID_PREFIX.membership),
    userId: user.id,
    organizationId: orgId,
    role,
    status: 'active',
    createdAt: new Date().toISOString(),
  }
  await repos.memberships.create(membership)
  const ws = await repos.workspaces.create({
    id: entityId(ID_PREFIX.workspace),
    tenantId: orgId,
    organizationId: orgId,
    name: 'WS',
    createdAt: new Date().toISOString(),
  })
  const proj = await repos.projects.create({
    id: entityId(ID_PREFIX.project),
    tenantId: orgId,
    workspaceId: ws.id,
    name: 'Project',
    status: 'active',
    createdAt: new Date().toISOString(),
  })
  const ctx = createTenantContext(orgId, user.id, membership)
  return { user, orgId, wsId: ws.id, projId: proj.id, ctx, membership }
}

/** Bootstrap a tenant with TWO projects in the same workspace. */
async function bootstrapTwoProjects(orgName: string, role: Role = 'owner') {
  const uniq = orgName + '_' + Math.random().toString(36).slice(2, 8)
  const user = await repos.users.create({
    id: entityId(ID_PREFIX.user),
    email: uniq + '@test',
    displayName: uniq,
    status: 'active',
    createdAt: new Date().toISOString(),
  })
  const orgId = entityId(ID_PREFIX.organization)
  await repos.orgs.create({
    id: orgId,
    tenantId: orgId,
    name: uniq,
    slug: uniq,
    status: 'active',
    createdAt: new Date().toISOString(),
  })
  const membership: Membership = {
    id: entityId(ID_PREFIX.membership),
    userId: user.id,
    organizationId: orgId,
    role,
    status: 'active',
    createdAt: new Date().toISOString(),
  }
  await repos.memberships.create(membership)
  const ws = await repos.workspaces.create({
    id: entityId(ID_PREFIX.workspace),
    tenantId: orgId,
    organizationId: orgId,
    name: 'WS',
    createdAt: new Date().toISOString(),
  })
  const projA = await repos.projects.create({
    id: entityId(ID_PREFIX.project),
    tenantId: orgId,
    workspaceId: ws.id,
    name: 'Project A',
    status: 'active',
    createdAt: new Date().toISOString(),
  })
  const projB = await repos.projects.create({
    id: entityId(ID_PREFIX.project),
    tenantId: orgId,
    workspaceId: ws.id,
    name: 'Project B',
    status: 'active',
    createdAt: new Date().toISOString(),
  })
  const ctx = createTenantContext(orgId, user.id, membership)
  return { user, orgId, wsId: ws.id, projA: projA.id, projB: projB.id, ctx, membership }
}

/**
 * Build a canonical EstimateRevisionPayload for testing.
 * Defaults: rate=500 (minor), qty=100 m2 → lineCost=50000 minor.
 */
function makePayload(projectId: string, rateMinor = 500, qty = 100): EstimateRevisionPayload {
  return estimateRevisionPayload({
    projectId,
    currency: currencyCode('GHS'),
    policy: {
      overheadPct: ratio(0.10),
      contingencyPct: ratio(0.05),
      targetProfitMode: 'markup',
      targetProfitRatio: ratio(0.10),
    },
    lines: [
      estimateLine({
        lineId: 'l1',
        boqItemId: null,
        description: 'Concrete',
        quantity: quantity(qty, UNITS.SQUARE_METRE),
        costBasis: 'unit-rate',
        rate: moneyFromMinor(rateMinor, 'GHS'),
        pricingStrategy: 'markup',
        pricingRatio: ratio(0.20),
      }),
    ],
    pricingAlgorithmVersion: 'v1',
  })
}

/**
 * Convenience: create a draft EstimateRevision via the service and finalize it.
 * Returns the finalized EstimateRevision (immutable commercial authority).
 */
async function createFinalizedEstimate(
  ctx: TenantContext,
  projectId: string,
  payload?: EstimateRevisionPayload,
): Promise<EstimateRevision> {
  const p = payload ?? makePayload(projectId)
  const draft = await services.estimates.createEstimateDraft(ctx, projectId, p)
  return services.estimates.finalizeEstimate(ctx, draft.metadata.revisionId)
}

/** Query audit events for an entity directly from the DB (verifies service emitted audit). */
async function auditEventsFor(tenantId: string, entityType: string, entityId: string) {
  return repos.audit.listForEntity(tenantId, entityType, entityId, 50)
}

// ═════════════════════════════════════════════════════════════
// §1 EstimateService — the central commercial authority
// ═════════════════════════════════════════════════════════════

describe('EstimateService', () => {
  it('createEstimateDraft: creates draft, audit emitted, project verified', async () => {
    const { orgId, projId, ctx, user } = await bootstrap('ES_Create')

    const payload = makePayload(projId)
    const draft = await services.estimates.createEstimateDraft(ctx, projId, payload)

    // Status is draft
    expect(draft.metadata.status).toBe('draft')
    expect(draft.metadata.authorityKind).toBe('estimate')
    expect(draft.metadata.projectId).toBe(projId)
    expect(draft.metadata.tenantId).toBe(orgId)
    expect(draft.metadata.createdBy).toBe(user.id)
    expect(draft.metadata.contentHash).toBe(estimateRevisionContentHash(payload))
    expect(draft.metadata.revisionNumber).toBeGreaterThanOrEqual(1)

    // Audit was emitted (estimate.draft_created action)
    const events = await auditEventsFor(orgId, 'revision', draft.metadata.revisionId)
    const created = events.find((e) => e.action === 'estimate.draft_created')
    expect(created, 'audit event estimate.draft_created must be emitted').toBeDefined()
    expect(created!.actorId).toBe(user.id)
    expect(created!.operation).toBe('create_draft')
    expect(created!.metadata).toMatchObject({ projectId: projId })

    // Project existence is verified — a non-existent project throws NotFoundError
    await expect(
      services.estimates.createEstimateDraft(ctx, 'proj_does_not_exist', makePayload('proj_does_not_exist')),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('getEstimateRevision: tenant-scoped read', async () => {
    const { orgId, projId, ctx } = await bootstrap('ES_Get')
    const draft = await services.estimates.createEstimateDraft(ctx, projId, makePayload(projId))

    const fetched = await services.estimates.getEstimateRevision(ctx, draft.metadata.revisionId)
    expect(fetched.metadata.revisionId).toBe(draft.metadata.revisionId)
    expect(fetched.metadata.tenantId).toBe(orgId)

    // Non-existent revision in this tenant → NotFoundError (existence not leaked)
    await expect(
      services.estimates.getEstimateRevision(ctx, 'rev_does_not_exist'),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('listEstimateRevisions: tenant-scoped list', async () => {
    const { orgId, projId, ctx } = await bootstrap('ES_List')
    const d1 = await services.estimates.createEstimateDraft(ctx, projId, makePayload(projId, 500, 100))
    const d2 = await services.estimates.createEstimateDraft(ctx, projId, makePayload(projId, 600, 50))

    const list = await services.estimates.listEstimateRevisions(ctx, projId)
    expect(list.length).toBe(2)
    const ids = list.map((r) => r.metadata.revisionId)
    expect(ids).toContain(d1.metadata.revisionId)
    expect(ids).toContain(d2.metadata.revisionId)
    // All returned revisions belong to this tenant
    for (const r of list) {
      expect(r.metadata.tenantId).toBe(orgId)
      expect(r.metadata.projectId).toBe(projId)
    }
  })

  it('updateEstimateDraft: only draft can be updated', async () => {
    const { projId, ctx } = await bootstrap('ES_UpdateDraft')
    const draft = await services.estimates.createEstimateDraft(ctx, projId, makePayload(projId, 500, 100))

    const newPayload = makePayload(projId, 600, 200)
    const updated = await services.estimates.updateEstimateDraft(ctx, draft.metadata.revisionId, newPayload)
    expect(updated.metadata.contentHash).toBe(estimateRevisionContentHash(newPayload))
    expect(updated.payload.lines[0]!.quantity.value).toBe(200)
    expect(updated.payload.lines[0]!.rate.amount).toBe(600)

    // Audit emitted
    const events = await auditEventsFor(ctx.tenantId, 'revision', draft.metadata.revisionId)
    expect(events.find((e) => e.action === 'estimate.draft_updated')).toBeDefined()
  })

  it('finalizeEstimate: draft→finalized; audit emitted', async () => {
    const { projId, ctx } = await bootstrap('ES_Finalize')
    const draft = await services.estimates.createEstimateDraft(ctx, projId, makePayload(projId))

    const finalized = await services.estimates.finalizeEstimate(ctx, draft.metadata.revisionId)
    expect(finalized.metadata.status).toBe('finalized')
    expect(finalized.metadata.finalizedAt).not.toBeNull()

    // Audit emitted
    const events = await auditEventsFor(ctx.tenantId, 'revision', draft.metadata.revisionId)
    expect(events.find((e) => e.action === 'estimate.finalized')).toBeDefined()
  })

  it('supersedeEstimate: only finalized→superseded', async () => {
    const { projId, ctx } = await bootstrap('ES_Supersede')
    const draft = await services.estimates.createEstimateDraft(ctx, projId, makePayload(projId))
    const finalized = await services.estimates.finalizeEstimate(ctx, draft.metadata.revisionId)

    const superseded = await services.estimates.supersedeEstimate(ctx, finalized.metadata.revisionId)
    expect(superseded.metadata.status).toBe('superseded')

    // Audit emitted
    const events = await auditEventsFor(ctx.tenantId, 'revision', draft.metadata.revisionId)
    expect(events.find((e) => e.action === 'estimate.superseded')).toBeDefined()
  })

  it('replayEstimate: load→reconstruct→verify hash→compute totals; contentHashMatches=true', async () => {
    const { projId, ctx } = await bootstrap('ES_Replay')
    const payload = makePayload(projId)
    const finalized = await createFinalizedEstimate(ctx, projId, payload)

    const replay = await services.estimates.replayEstimate(ctx, finalized.metadata.revisionId)

    // Hash verification
    expect(replay.contentHashMatches).toBe(true)
    expect(replay.storedHash).toBe(replay.calculatedHash)
    expect(replay.storedHash).toBe(estimateRevisionContentHash(payload))

    // Totals match the recomputed totals from the original payload
    const originalTotals = computeEstimateRevisionTotals(payload)
    expect(replay.totals.totalLineCost.amount).toBe(originalTotals.totalLineCost.amount)
    expect(replay.totals.totalCost.amount).toBe(originalTotals.totalCost.amount)
    expect(replay.totals.profit.amount).toBe(originalTotals.profit.amount)
    expect(replay.totals.sellPrice.amount).toBe(originalTotals.sellPrice.amount)
    expect(replay.totals.grossProfit.amount).toBe(originalTotals.grossProfit.amount)

    // Sanity: 500 × 100 = 50000 minor line cost
    expect(replay.totals.totalLineCost.amount).toBe(50000)
  })
})

// ═════════════════════════════════════════════════════════════
// §2 BidService — commercial submission decisions
// ═════════════════════════════════════════════════════════════

describe('BidService', () => {
  it('createBid: cross-entity validation (same tenant, same project); content hash from actual revision (not client-supplied)', async () => {
    const { projId, ctx } = await bootstrap('Bid_Create')
    const finalized = await createFinalizedEstimate(ctx, projId)

    // The BidService computes the hash from the actual loaded revision, ignoring
    // any client-supplied value. There is no client-supplied hash parameter on
    // createBid — the service computes it internally.
    const bid = await services.bids.createBid(
      ctx,
      projId,
      finalized.metadata.revisionId,
      money(632.50, 'GHS'),
    )

    expect(bid.status).toBe('draft')
    expect(bid.projectId).toBe(projId)
    expect(bid.estimateRevisionId).toBe(finalized.metadata.revisionId)
    // The bid's hash MUST match the actual revision's hash (computed by service)
    expect(bid.estimateRevisionContentHash).toBe(finalized.metadata.contentHash)

    // Audit emitted
    const events = await auditEventsFor(ctx.tenantId, 'bid', bid.bidId)
    expect(events.find((e) => e.action === 'bid.created')).toBeDefined()

    // Cross-tenant bid: Tenant B tries to create a bid referencing Tenant A's
    // revision. The revision lookup is tenant-scoped → NotFoundError (existence
    // not leaked). Cross-PROJECT validation within the SAME tenant is covered in §7.
    const other = await bootstrap('Bid_Create_Other')
    await expect(
      services.bids.createBid(
        other.ctx,
        other.projId,
        finalized.metadata.revisionId,
        money(100, 'GHS'),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Non-existent revision → NotFoundError
    await expect(
      services.bids.createBid(ctx, projId, 'rev_does_not_exist', money(100, 'GHS')),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('submitBid: verifies finalized revision, runs validateBidSubmission, status→submitted', async () => {
    const { projId, ctx } = await bootstrap('Bid_Submit')
    const finalized = await createFinalizedEstimate(ctx, projId)
    const bid = await services.bids.createBid(ctx, projId, finalized.metadata.revisionId, money(700, 'GHS'))

    const submitted = await services.bids.submitBid(ctx, bid.bidId)
    expect(submitted.status).toBe('submitted')

    // Audit emitted
    const events = await auditEventsFor(ctx.tenantId, 'bid', bid.bidId)
    expect(events.find((e) => e.action === 'bid.submitted')).toBeDefined()
  })

  it('submitBid rejects when revision is not finalized', async () => {
    const { projId, ctx } = await bootstrap('Bid_SubmitDraft')
    // Create a DRAFT revision (not finalized)
    const draft = await services.estimates.createEstimateDraft(ctx, projId, makePayload(projId))
    // Bid referencing draft revision is allowed at create time
    const bid = await services.bids.createBid(ctx, projId, draft.metadata.revisionId, money(100, 'GHS'))

    // But submission fails: revision is not finalized → ValidationError
    await expect(services.bids.submitBid(ctx, bid.bidId)).rejects.toBeInstanceOf(ValidationError)
  })

  it('recordBidOutcome: submitted→won/lost; terminal states rejected', async () => {
    const { projId, ctx } = await bootstrap('Bid_Outcome')
    const finalized = await createFinalizedEstimate(ctx, projId)
    const bid = await services.bids.createBid(ctx, projId, finalized.metadata.revisionId, money(700, 'GHS'))
    const submitted = await services.bids.submitBid(ctx, bid.bidId)

    const won = await services.bids.recordBidOutcome(ctx, bid.bidId, 'won', 'Awarded')
    expect(won.status).toBe('won')
    expect(won.bidId).toBe(submitted.bidId)

    // Cannot record outcome again (terminal state) → ConflictError
    await expect(
      services.bids.recordBidOutcome(ctx, bid.bidId, 'lost'),
    ).rejects.toBeInstanceOf(ConflictError)

    // Audit emitted for the won outcome
    const events = await auditEventsFor(ctx.tenantId, 'bid', bid.bidId)
    expect(events.find((e) => e.action === 'bid.won')).toBeDefined()
  })

  it('recordBidOutcome: submitted→lost', async () => {
    const { projId, ctx } = await bootstrap('Bid_Lost')
    const finalized = await createFinalizedEstimate(ctx, projId)
    const bid = await services.bids.createBid(ctx, projId, finalized.metadata.revisionId, money(700, 'GHS'))
    await services.bids.submitBid(ctx, bid.bidId)

    const lost = await services.bids.recordBidOutcome(ctx, bid.bidId, 'lost')
    expect(lost.status).toBe('lost')
  })

  it('withdrawBid: non-terminal→withdrawn; terminal rejected', async () => {
    const { projId, ctx } = await bootstrap('Bid_Withdraw')
    const finalized = await createFinalizedEstimate(ctx, projId)
    const bid = await services.bids.createBid(ctx, projId, finalized.metadata.revisionId, money(700, 'GHS'))

    // Draft can be withdrawn
    const withdrawn = await services.bids.withdrawBid(ctx, bid.bidId)
    expect(withdrawn.status).toBe('withdrawn')

    // Withdrawn is terminal — cannot withdraw again
    await expect(services.bids.withdrawBid(ctx, bid.bidId)).rejects.toBeInstanceOf(ConflictError)

    // Audit emitted
    const events = await auditEventsFor(ctx.tenantId, 'bid', bid.bidId)
    expect(events.find((e) => e.action === 'bid.withdrawn')).toBeDefined()
  })

  it('withdrawBid rejects on terminal state (won)', async () => {
    const { projId, ctx } = await bootstrap('Bid_WithdrawTerminal')
    const finalized = await createFinalizedEstimate(ctx, projId)
    const bid = await services.bids.createBid(ctx, projId, finalized.metadata.revisionId, money(700, 'GHS'))
    await services.bids.submitBid(ctx, bid.bidId)
    await services.bids.recordBidOutcome(ctx, bid.bidId, 'won')

    // Won is terminal — cannot withdraw
    await expect(services.bids.withdrawBid(ctx, bid.bidId)).rejects.toBeInstanceOf(ConflictError)
  })

  it('getBid, listBids: tenant-scoped', async () => {
    const { projId, ctx } = await bootstrap('Bid_Read')
    const finalized = await createFinalizedEstimate(ctx, projId)
    const bid = await services.bids.createBid(ctx, projId, finalized.metadata.revisionId, money(700, 'GHS'))

    const fetched = await services.bids.getBid(ctx, bid.bidId)
    expect(fetched.bidId).toBe(bid.bidId)

    const list = await services.bids.listBids(ctx, projId)
    expect(list.length).toBe(1)
    expect(list[0]!.bidId).toBe(bid.bidId)

    // Non-existent bid → NotFoundError
    await expect(services.bids.getBid(ctx, 'aud_does_not_exist')).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ═════════════════════════════════════════════════════════════
// §3 BOQService — scope structure (mutable, NOT commercial authority)
// ═════════════════════════════════════════════════════════════

describe('BOQService', () => {
  it('createBOQ + getBOQ + listBOQs + addBOQItem + updateBOQItemQuantity + getBOQItems', async () => {
    const { orgId, projId, ctx } = await bootstrap('BOQ_Crud')

    const boq = await services.boqs.createBOQ(ctx, projId, 'Test BOQ')
    expect(boq.boqId).toBeDefined()
    expect(boq.projectId).toBe(projId)

    // getBOQ
    const fetched = await services.boqs.getBOQ(ctx, boq.boqId)
    expect(fetched.boqId).toBe(boq.boqId)

    // listBOQs
    const list = await services.boqs.listBOQs(ctx, projId)
    expect(list.length).toBe(1)

    // addBOQItem
    const item = await services.boqs.addBOQItem(ctx, boq.boqId, {
      itemCode: '1.1',
      description: 'Concrete',
      unit: 'm2',
      quantityValue: 100,
      quantityUnit: 'm2',
      provenance: 'manual',
    })
    expect(item.itemCode).toBe('1.1')
    expect(item.quantity.value).toBe(100)

    // getBOQItems
    const items = await services.boqs.getBOQItems(ctx, boq.boqId)
    expect(items.length).toBe(1)
    expect(items[0]!.itemId).toBe(item.itemId)

    // updateBOQItemQuantity
    const updated = await services.boqs.updateBOQItemQuantity(ctx, item.itemId, 120, 'm2')
    expect(updated).toBe(true)
    const itemsAfter = await services.boqs.getBOQItems(ctx, boq.boqId)
    expect(itemsAfter[0]!.quantity.value).toBe(120)

    // Audit emitted for BOQ + item operations
    const boqEvents = await auditEventsFor(orgId, 'boq', boq.boqId)
    expect(boqEvents.find((e) => e.action === 'boq.created')).toBeDefined()
    const itemEvents = await auditEventsFor(orgId, 'boq_item', item.itemId)
    expect(itemEvents.find((e) => e.action === 'boq.item_added')).toBeDefined()
    expect(itemEvents.find((e) => e.action === 'boq.item_quantity_updated')).toBeDefined()

    // Non-existent BOQ → NotFoundError
    await expect(services.boqs.getBOQ(ctx, 'ws_does_not_exist')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('BOQ change does NOT affect finalized EstimateRevision (snapshot, not live reference)', async () => {
    const { projId, ctx } = await bootstrap('BOQ_Snapshot')

    // Create BOQ with item qty=100
    const boq = await services.boqs.createBOQ(ctx, projId, 'Snap BOQ')
    const item = await services.boqs.addBOQItem(ctx, boq.boqId, {
      itemCode: '1.1',
      description: 'Concrete',
      unit: 'm2',
      quantityValue: 100,
      quantityUnit: 'm2',
      provenance: 'manual',
    })

    // Create EstimateRevision with line qty=100 (snapshot from BOQ)
    const payload = estimateRevisionPayload({
      projectId: projId,
      currency: currencyCode('GHS'),
      policy: {
        overheadPct: ratio(0.10),
        contingencyPct: ratio(0.05),
        targetProfitMode: 'markup',
        targetProfitRatio: ratio(0.10),
      },
      lines: [
        estimateLine({
          lineId: 'l1',
          boqItemId: item.itemId,
          description: 'Concrete',
          quantity: quantity(100, UNITS.SQUARE_METRE),
          costBasis: 'unit-rate',
          rate: moneyFromMinor(500, 'GHS'),
          pricingStrategy: 'markup',
          pricingRatio: ratio(0.20),
        }),
      ],
      pricingAlgorithmVersion: 'v1',
    })
    const finalized = await createFinalizedEstimate(ctx, projId, payload)

    // Now mutate the BOQ quantity to 120
    await services.boqs.updateBOQItemQuantity(ctx, item.itemId, 120, 'm2')
    const itemAfter = await repos.boq.getItem(item.itemId, ctx.tenantId)
    expect(itemAfter!.quantity.value).toBe(120)

    // The finalized revision's line quantity is STILL 100 (snapshot preserved)
    const reloaded = await services.estimates.getEstimateRevision(ctx, finalized.metadata.revisionId)
    expect(reloaded.payload.lines[0]!.quantity.value).toBe(100)

    // Replay confirms financial result is unchanged: 500 × 100 = 50000 minor
    const replay = await services.estimates.replayEstimate(ctx, finalized.metadata.revisionId)
    expect(replay.totals.totalLineCost.amount).toBe(50000)
    expect(replay.contentHashMatches).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════
// §4 PlanMeasurementService — measurement evidence (no pricing)
// ═════════════════════════════════════════════════════════════

describe('PlanMeasurementService', () => {
  it('createMeasurement + getMeasurement + listMeasurements; provenance preserved; no commercial fields', async () => {
    const { orgId, projId, ctx, user } = await bootstrap('PM_CRUD')

    const pm = await services.measurements.createMeasurement(ctx, projId, {
      sourceArtifactId: 'art_test',
      sourceArtifactHash: 'hash_test',
      sheetId: 's1',
      sheetRevision: 'r1',
      elementReference: 'e1',
      quantityValue: 42.5,
      quantityUnit: 'm2',
      measurementMethod: 'manual-takeoff',
      measurementBasis: 'area',
      measurementEngineVersion: 'v1',
    })

    expect(pm.measurementId).toBeDefined()
    expect(pm.sourceArtifactId).toBe('art_test')
    expect(pm.sourceArtifactHash).toBe('hash_test')
    expect(pm.sheetId).toBe('s1')
    expect(pm.sheetRevision).toBe('r1')
    expect(pm.elementReference).toBe('e1')
    expect(pm.quantity.value).toBeCloseTo(42.5, 4)
    expect(pm.quantity.unit).toBe('m2')
    expect(pm.measurementMethod).toBe('manual-takeoff')
    expect(pm.measurementBasis).toBe('area')
    expect(pm.measurementEngineVersion).toBe('v1')
    expect(pm.actorId).toBe(user.id)
    // Provenance is preserved end-to-end through persistence
    expect(pm.provisional).toBe(false)

    // CRITICAL: PlanMeasurement must NOT carry commercial fields (no money, no rate, no pricing)
    expect(('rate' in pm) || ('price' in pm) || ('finalPrice' in pm)).toBe(false)

    // getMeasurement
    const fetched = await services.measurements.getMeasurement(ctx, pm.measurementId)
    expect(fetched.measurementId).toBe(pm.measurementId)
    expect(fetched.sourceArtifactHash).toBe('hash_test')

    // listMeasurements
    const list = await services.measurements.listMeasurements(ctx, projId)
    expect(list.length).toBe(1)
    expect(list[0]!.measurementId).toBe(pm.measurementId)

    // Audit emitted
    const events = await auditEventsFor(orgId, 'plan_measurement', pm.measurementId)
    expect(events.find((e) => e.action === 'plan.measurement_created')).toBeDefined()

    // Non-existent project → NotFoundError
    await expect(
      services.measurements.createMeasurement(ctx, 'proj_does_not_exist', {
        sourceArtifactId: 'a',
        sourceArtifactHash: 'h',
        sheetId: null,
        sheetRevision: null,
        elementReference: 'e',
        quantityValue: 1,
        quantityUnit: 'm2',
        measurementMethod: 'manual-takeoff',
        measurementBasis: 'count',
        measurementEngineVersion: 'v1',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ═════════════════════════════════════════════════════════════
// §5 Authorization — viewer / member / owner / admin boundaries
// ═════════════════════════════════════════════════════════════

describe('Authorization (role-based permission boundaries)', () => {
  it('viewer: can read estimates/bids/boqs/measurements; CANNOT create/finalize/submit', async () => {
    // Bootstrap a tenant as owner and seed commercial data, then add a viewer
    // membership in the SAME tenant to test read vs. write boundaries.
    const shared = await bootstrap('AuthViewerShared', 'owner')
    const finalized = await createFinalizedEstimate(shared.ctx, shared.projId)
    const bid = await services.bids.createBid(
      shared.ctx,
      shared.projId,
      finalized.metadata.revisionId,
      money(700, 'GHS'),
    )
    const boq = await services.boqs.createBOQ(shared.ctx, shared.projId, 'V BOQ')
    const pm = await services.measurements.createMeasurement(shared.ctx, shared.projId, {
      sourceArtifactId: 'art',
      sourceArtifactHash: 'hash',
      sheetId: null,
      sheetRevision: null,
      elementReference: 'e',
      quantityValue: 1,
      quantityUnit: 'm2',
      measurementMethod: 'manual-takeoff',
      measurementBasis: 'area',
      measurementEngineVersion: 'v1',
    })

    // Add a viewer membership in the SAME tenant
    const viewerUser = await repos.users.create({
      id: entityId(ID_PREFIX.user),
      email: 'shared_viewer@test',
      displayName: 'Shared Viewer',
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    const viewerMembership: Membership = {
      id: entityId(ID_PREFIX.membership),
      userId: viewerUser.id,
      organizationId: shared.orgId,
      role: 'viewer',
      status: 'active',
      createdAt: new Date().toISOString(),
    }
    await repos.memberships.create(viewerMembership)
    const viewerCtx = createTenantContext(shared.orgId, viewerUser.id, viewerMembership)

    // CAN read estimates, bids, boqs, measurements
    await expect(
      services.estimates.getEstimateRevision(viewerCtx, finalized.metadata.revisionId),
    ).resolves.toBeDefined()
    await expect(services.bids.getBid(viewerCtx, bid.bidId)).resolves.toBeDefined()
    await expect(services.boqs.getBOQ(viewerCtx, boq.boqId)).resolves.toBeDefined()
    await expect(services.measurements.getMeasurement(viewerCtx, pm.measurementId)).resolves.toBeDefined()

    // CANNOT create estimate (estimate:write)
    await expect(
      services.estimates.createEstimateDraft(viewerCtx, shared.projId, makePayload(shared.projId)),
    ).rejects.toBeInstanceOf(UnauthorizedError)

    // CANNOT finalize (estimate:finalize)
    const draftForFinalize = await services.estimates.createEstimateDraft(
      shared.ctx, shared.projId, makePayload(shared.projId),
    )
    await expect(
      services.estimates.finalizeEstimate(viewerCtx, draftForFinalize.metadata.revisionId),
    ).rejects.toBeInstanceOf(UnauthorizedError)

    // CANNOT create bid (bid:write)
    await expect(
      services.bids.createBid(viewerCtx, shared.projId, finalized.metadata.revisionId, money(100, 'GHS')),
    ).rejects.toBeInstanceOf(UnauthorizedError)

    // CANNOT submit bid (bid:submit)
    await expect(services.bids.submitBid(viewerCtx, bid.bidId)).rejects.toBeInstanceOf(UnauthorizedError)

    // CANNOT create BOQ (boq:write)
    await expect(services.boqs.createBOQ(viewerCtx, shared.projId, 'X')).rejects.toBeInstanceOf(UnauthorizedError)

    // CANNOT create PlanMeasurement (plan:write)
    await expect(
      services.measurements.createMeasurement(viewerCtx, shared.projId, {
        sourceArtifactId: 'a', sourceArtifactHash: 'h', sheetId: null, sheetRevision: null,
        elementReference: 'e', quantityValue: 1, quantityUnit: 'm2',
        measurementMethod: 'manual-takeoff', measurementBasis: 'area',
        measurementEngineVersion: 'v1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('member: can create/update drafts + create bids; CANNOT finalize or submit', async () => {
    const shared = await bootstrap('AuthMemberShared', 'owner')
    // Seed a finalized estimate via owner (member cannot finalize)
    const finalized = await createFinalizedEstimate(shared.ctx, shared.projId)

    // Create a member in the same tenant
    const memberUser = await repos.users.create({
      id: entityId(ID_PREFIX.user),
      email: 'shared_member@test',
      displayName: 'Shared Member',
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    const memberMembership: Membership = {
      id: entityId(ID_PREFIX.membership),
      userId: memberUser.id,
      organizationId: shared.orgId,
      role: 'member',
      status: 'active',
      createdAt: new Date().toISOString(),
    }
    await repos.memberships.create(memberMembership)
    const memberCtx = createTenantContext(shared.orgId, memberUser.id, memberMembership)

    // CAN create estimate draft (estimate:write)
    const draft = await services.estimates.createEstimateDraft(memberCtx, shared.projId, makePayload(shared.projId))
    expect(draft.metadata.status).toBe('draft')

    // CAN update draft
    const updated = await services.estimates.updateEstimateDraft(
      memberCtx,
      draft.metadata.revisionId,
      makePayload(shared.projId, 600, 200),
    )
    expect(updated.payload.lines[0]!.quantity.value).toBe(200)

    // CAN create bid (bid:write)
    const bid = await services.bids.createBid(
      memberCtx,
      shared.projId,
      finalized.metadata.revisionId,
      money(700, 'GHS'),
    )
    expect(bid.status).toBe('draft')

    // CANNOT finalize (estimate:finalize)
    await expect(
      services.estimates.finalizeEstimate(memberCtx, draft.metadata.revisionId),
    ).rejects.toBeInstanceOf(UnauthorizedError)

    // CANNOT supersede (estimate:finalize)
    const finalizedForMember = await services.estimates.finalizeEstimate(shared.ctx, draft.metadata.revisionId)
    await expect(
      services.estimates.supersedeEstimate(memberCtx, finalizedForMember.metadata.revisionId),
    ).rejects.toBeInstanceOf(UnauthorizedError)

    // CANNOT submit bid (bid:submit)
    await expect(services.bids.submitBid(memberCtx, bid.bidId)).rejects.toBeInstanceOf(UnauthorizedError)

    // CANNOT record bid outcome (bid:submit)
    const submittedBid = await services.bids.submitBid(shared.ctx, bid.bidId)
    await expect(
      services.bids.recordBidOutcome(memberCtx, submittedBid.bidId, 'won'),
    ).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('owner and admin: can finalize, supersede, submit bids', async () => {
    // Owner
    const owner = await bootstrap('AuthOwner', 'owner')
    const ownerDraft = await services.estimates.createEstimateDraft(owner.ctx, owner.projId, makePayload(owner.projId))
    const ownerFinalized = await services.estimates.finalizeEstimate(owner.ctx, ownerDraft.metadata.revisionId)
    expect(ownerFinalized.metadata.status).toBe('finalized')
    const ownerSuperseded = await services.estimates.supersedeEstimate(owner.ctx, ownerFinalized.metadata.revisionId)
    expect(ownerSuperseded.metadata.status).toBe('superseded')

    // Owner can submit bids
    const finalizedForBid = await createFinalizedEstimate(owner.ctx, owner.projId)
    const ownerBid = await services.bids.createBid(owner.ctx, owner.projId, finalizedForBid.metadata.revisionId, money(700, 'GHS'))
    const ownerSubmitted = await services.bids.submitBid(owner.ctx, ownerBid.bidId)
    expect(ownerSubmitted.status).toBe('submitted')

    // Admin
    const admin = await bootstrap('AuthAdmin', 'admin')
    const adminDraft = await services.estimates.createEstimateDraft(admin.ctx, admin.projId, makePayload(admin.projId))
    const adminFinalized = await services.estimates.finalizeEstimate(admin.ctx, adminDraft.metadata.revisionId)
    expect(adminFinalized.metadata.status).toBe('finalized')
    const adminSuperseded = await services.estimates.supersedeEstimate(admin.ctx, adminFinalized.metadata.revisionId)
    expect(adminSuperseded.metadata.status).toBe('superseded')
  })

  it('no-membership context: all operations fail', async () => {
    const owner = await bootstrap('AuthNoMember', 'owner')
    // Seed data so we have IDs to attempt operations against
    const finalized = await createFinalizedEstimate(owner.ctx, owner.projId)
    const bid = await services.bids.createBid(
      owner.ctx,
      owner.projId,
      finalized.metadata.revisionId,
      money(700, 'GHS'),
    )
    const boq = await services.boqs.createBOQ(owner.ctx, owner.projId, 'N BOQ')

    // Stranger: an authenticated user with NO membership in this tenant.
    // createTenantContext with null membership yields zero permissions.
    const strangerCtx = createTenantContext(owner.orgId, 'usr_stranger_no_member', null)

    // Every operation that requires a permission must fail with UnauthorizedError
    await expect(
      services.estimates.createEstimateDraft(strangerCtx, owner.projId, makePayload(owner.projId)),
    ).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(
      services.estimates.getEstimateRevision(strangerCtx, finalized.metadata.revisionId),
    ).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(
      services.estimates.finalizeEstimate(strangerCtx, finalized.metadata.revisionId),
    ).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(
      services.bids.createBid(strangerCtx, owner.projId, finalized.metadata.revisionId, money(100, 'GHS')),
    ).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(services.bids.getBid(strangerCtx, bid.bidId)).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(services.bids.submitBid(strangerCtx, bid.bidId)).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(services.boqs.createBOQ(strangerCtx, owner.projId, 'X')).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(services.boqs.getBOQ(strangerCtx, boq.boqId)).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(
      services.measurements.createMeasurement(strangerCtx, owner.projId, {
        sourceArtifactId: 'a', sourceArtifactHash: 'h', sheetId: null, sheetRevision: null,
        elementReference: 'e', quantityValue: 1, quantityUnit: 'm2',
        measurementMethod: 'manual-takeoff', measurementBasis: 'area',
        measurementEngineVersion: 'v1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

// ═════════════════════════════════════════════════════════════
// §6 Tenant isolation at the service layer
// ═════════════════════════════════════════════════════════════

describe('Tenant isolation (service layer)', () => {
  it('Tenant A cannot read/update/finalize Tenant B’s estimate', async () => {
    const a = await bootstrap('TI_Est_A')
    const b = await bootstrap('TI_Est_B')
    const bDraft = await services.estimates.createEstimateDraft(b.ctx, b.projId, makePayload(b.projId))

    // Tenant A reading B's revision → NotFoundError (existence not leaked)
    await expect(
      services.estimates.getEstimateRevision(a.ctx, bDraft.metadata.revisionId),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Tenant A updating B's draft → NotFoundError (not ConflictError)
    await expect(
      services.estimates.updateEstimateDraft(a.ctx, bDraft.metadata.revisionId, makePayload(b.projId, 600, 200)),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Tenant A finalizing B's draft → NotFoundError
    await expect(
      services.estimates.finalizeEstimate(a.ctx, bDraft.metadata.revisionId),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Tenant A superseding B's finalized revision → NotFoundError
    const bFinalized = await services.estimates.finalizeEstimate(b.ctx, bDraft.metadata.revisionId)
    await expect(
      services.estimates.supersedeEstimate(a.ctx, bFinalized.metadata.revisionId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('Tenant A cannot read Tenant B’s BOQ', async () => {
    const a = await bootstrap('TI_BOQ_A')
    const b = await bootstrap('TI_BOQ_B')
    const bBoq = await services.boqs.createBOQ(b.ctx, b.projId, 'B BOQ')

    await expect(services.boqs.getBOQ(a.ctx, bBoq.boqId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(services.boqs.getBOQItems(a.ctx, bBoq.boqId)).resolves.toEqual([])
  })

  it('Tenant A cannot create bid referencing Tenant B’s revision', async () => {
    const a = await bootstrap('TI_BidCreate_A')
    const b = await bootstrap('TI_BidCreate_B')
    const bFinalized = await createFinalizedEstimate(b.ctx, b.projId)

    // Tenant A tries to create a bid referencing B's revision (in B's tenant).
    // The BidService loads the revision via TenantA's ctx → not found → NotFoundError.
    await expect(
      services.bids.createBid(a.ctx, b.projId, bFinalized.metadata.revisionId, money(100, 'GHS')),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('Tenant A cannot submit Tenant B’s bid', async () => {
    const a = await bootstrap('TI_BidSubmit_A')
    const b = await bootstrap('TI_BidSubmit_B')
    const bFinalized = await createFinalizedEstimate(b.ctx, b.projId)
    const bBid = await services.bids.createBid(b.ctx, b.projId, bFinalized.metadata.revisionId, money(700, 'GHS'))

    // Tenant A tries to submit B's bid → NotFoundError (bid not visible to A)
    await expect(services.bids.submitBid(a.ctx, bBid.bidId)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('Tenant A cannot read Tenant B’s bid', async () => {
    const a = await bootstrap('TI_BidRead_A')
    const b = await bootstrap('TI_BidRead_B')
    const bFinalized = await createFinalizedEstimate(b.ctx, b.projId)
    const bBid = await services.bids.createBid(b.ctx, b.projId, bFinalized.metadata.revisionId, money(700, 'GHS'))

    await expect(services.bids.getBid(a.ctx, bBid.bidId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(services.bids.listBids(a.ctx, b.projId)).resolves.toEqual([])
  })

  it('Tenant A cannot read Tenant B’s PlanMeasurement', async () => {
    const a = await bootstrap('TI_PM_A')
    const b = await bootstrap('TI_PM_B')
    const bPm = await services.measurements.createMeasurement(b.ctx, b.projId, {
      sourceArtifactId: 'art', sourceArtifactHash: 'hash', sheetId: null, sheetRevision: null,
      elementReference: 'e', quantityValue: 1, quantityUnit: 'm2',
      measurementMethod: 'manual-takeoff', measurementBasis: 'area',
      measurementEngineVersion: 'v1',
    })

    await expect(services.measurements.getMeasurement(a.ctx, bPm.measurementId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(services.measurements.listMeasurements(a.ctx, b.projId)).resolves.toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════
// §7 Cross-project tests (same tenant)
// ═════════════════════════════════════════════════════════════

describe('Cross-project (same tenant)', () => {
  it('Bid for Project A cannot reference Project B’s EstimateRevision (ValidationError)', async () => {
    const { projA, projB, ctx } = await bootstrapTwoProjects('XProj_BidMismatch')
    // Finalize a revision in Project A
    const finalizedA = await createFinalizedEstimate(ctx, projA)

    // Attempt to create a bid "for Project B" referencing Project A's revision
    await expect(
      services.bids.createBid(ctx, projB, finalizedA.metadata.revisionId, money(700, 'GHS')),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('Estimate service cannot update a revision with a payload from another project (ValidationError)', async () => {
    const { projA, projB, ctx } = await bootstrapTwoProjects('XProj_PayloadMismatch')
    // Create a draft in Project A
    const draftA = await services.estimates.createEstimateDraft(ctx, projA, makePayload(projA))

    // Try to update it using a payload whose projectId is Project B → ValidationError
    await expect(
      services.estimates.updateEstimateDraft(ctx, draftA.metadata.revisionId, makePayload(projB, 600, 200)),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('createEstimateDraft rejects when payload projectId does not match the requested project', async () => {
    const { projA, projB, ctx } = await bootstrapTwoProjects('XProj_CreateMismatch')

    await expect(
      services.estimates.createEstimateDraft(ctx, projA, makePayload(projB)),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

// ═════════════════════════════════════════════════════════════
// §8 Finalized immutability through the service
// ═════════════════════════════════════════════════════════════

describe('Finalized immutability through the service', () => {
  it('updateEstimateDraft on finalized → ConflictError', async () => {
    const { projId, ctx } = await bootstrap('Immut_Upd_Finalized')
    const finalized = await createFinalizedEstimate(ctx, projId)

    await expect(
      services.estimates.updateEstimateDraft(ctx, finalized.metadata.revisionId, makePayload(projId, 600, 200)),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('updateEstimateDraft on superseded → ConflictError', async () => {
    const { projId, ctx } = await bootstrap('Immut_Upd_Superseded')
    const finalized = await createFinalizedEstimate(ctx, projId)
    await services.estimates.supersedeEstimate(ctx, finalized.metadata.revisionId)

    await expect(
      services.estimates.updateEstimateDraft(ctx, finalized.metadata.revisionId, makePayload(projId, 600, 200)),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('finalizeEstimate on already-finalized → ConflictError', async () => {
    const { projId, ctx } = await bootstrap('Immut_Fin_Fin')
    const finalized = await createFinalizedEstimate(ctx, projId)

    await expect(
      services.estimates.finalizeEstimate(ctx, finalized.metadata.revisionId),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('supersedeEstimate on draft → ConflictError (only finalized can be superseded)', async () => {
    const { projId, ctx } = await bootstrap('Immut_Sup_Draft')
    const draft = await services.estimates.createEstimateDraft(ctx, projId, makePayload(projId))

    await expect(
      services.estimates.supersedeEstimate(ctx, draft.metadata.revisionId),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('supersedeEstimate on superseded → ConflictError', async () => {
    const { projId, ctx } = await bootstrap('Immut_Sup_Sup')
    const finalized = await createFinalizedEstimate(ctx, projId)
    await services.estimates.supersedeEstimate(ctx, finalized.metadata.revisionId)

    await expect(
      services.estimates.supersedeEstimate(ctx, finalized.metadata.revisionId),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('submitBid on already-submitted bid → ConflictError', async () => {
    const { projId, ctx } = await bootstrap('Immut_BidSubmit_Twice')
    const finalized = await createFinalizedEstimate(ctx, projId)
    const bid = await services.bids.createBid(ctx, projId, finalized.metadata.revisionId, money(700, 'GHS'))
    await services.bids.submitBid(ctx, bid.bidId)

    await expect(services.bids.submitBid(ctx, bid.bidId)).rejects.toBeInstanceOf(ConflictError)
  })
})

// ═════════════════════════════════════════════════════════════
// §9 Hash verification on finalization (defense in depth)
// ═════════════════════════════════════════════════════════════

describe('Hash verification on finalization', () => {
  it('finalizeEstimate verifies stored hash == recomputed hash (positive: matches)', async () => {
    const { projId, ctx } = await bootstrap('HashVerify_Positive')
    const draft = await services.estimates.createEstimateDraft(ctx, projId, makePayload(projId))

    // finalize succeeds because the stored hash matches the recomputed hash
    const finalized = await services.estimates.finalizeEstimate(ctx, draft.metadata.revisionId)
    expect(finalized.metadata.status).toBe('finalized')
    // The stored hash equals the recomputed hash from the payload
    const recomputed = estimateRevisionContentHash(finalized.payload)
    expect(finalized.metadata.contentHash).toBe(recomputed)
  })

  it('finalizeEstimate rejects when stored hash != recomputed hash (tampered draft)', async () => {
    const { projId, ctx } = await bootstrap('HashVerify_Negative')
    const draft = await services.estimates.createEstimateDraft(ctx, projId, makePayload(projId))

    // Tamper with the stored content_hash directly in the revisions table.
    // The revisions trigger allows UPDATE on draft rows, so this succeeds.
    // The payload remains unchanged → recomputed hash will differ from the
    // tampered stored hash → finalizeEstimate must throw ConflictError.
    await db.execute(
      `UPDATE revisions SET content_hash = $1 WHERE revision_id = $2`,
      ['TAMPERED_HASH_VALUE', draft.metadata.revisionId],
    )

    await expect(
      services.estimates.finalizeEstimate(ctx, draft.metadata.revisionId),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

// ═════════════════════════════════════════════════════════════
// §10 Bid hash verification on submission (defense in depth)
// ═════════════════════════════════════════════════════════════

describe('Bid hash verification on submission', () => {
  it('submitBid verifies bid.estimateRevisionContentHash == actual revision hash (positive: matches)', async () => {
    const { projId, ctx } = await bootstrap('BidHash_Positive')
    const finalized = await createFinalizedEstimate(ctx, projId)
    const bid = await services.bids.createBid(ctx, projId, finalized.metadata.revisionId, money(700, 'GHS'))

    // submitBid succeeds because the bid's stored hash matches the revision's actual hash
    const submitted = await services.bids.submitBid(ctx, bid.bidId)
    expect(submitted.status).toBe('submitted')
    expect(submitted.estimateRevisionContentHash).toBe(finalized.metadata.contentHash)
  })

  it('submitBid rejects when bid.estimateRevisionContentHash != actual revision hash (tampered bid)', async () => {
    const { projId, ctx } = await bootstrap('BidHash_Negative')
    const finalized = await createFinalizedEstimate(ctx, projId)
    const bid = await services.bids.createBid(ctx, projId, finalized.metadata.revisionId, money(700, 'GHS'))

    // Tamper with the bid's stored hash directly in the bids table.
    // The bids table has no immutability trigger, so the UPDATE succeeds.
    // The revision's actual hash differs from the tampered bid hash → submitBid
    // must throw ConflictError.
    await db.execute(
      `UPDATE bids SET estimate_revision_content_hash = $1 WHERE bid_id = $2`,
      ['TAMPERED_BID_HASH', bid.bidId],
    )

    await expect(services.bids.submitBid(ctx, bid.bidId)).rejects.toBeInstanceOf(ConflictError)
  })
})
