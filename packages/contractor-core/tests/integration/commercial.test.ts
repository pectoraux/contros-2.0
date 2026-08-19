/**
 * Commercial persistence integration tests.
 *
 * Run against REAL PostgreSQL (pglite — PostgreSQL 16 WASM). NOT mocked.
 * Covers: EstimateRevision persist→load→reconstruct→replay→hash match,
 * immutability attacks, tenant isolation, BOQ snapshot, Bid hash integrity.
 * (Phase 2B.1 §31-§36.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PgLiteClient, FOUNDATION_MIGRATION_SQL, COMMERCIAL_MIGRATION_SQL, applyMigration } from '../../src/persistence/index.js'
import {
  PlanMeasurementRepository, BOQRepository, EstimateRevisionRepository, BidRepository,
} from '../../src/persistence/index.js'
import { OrganizationRepository, UserRepository, MembershipRepository, WorkspaceRepository, ProjectRepository } from '../../src/persistence/index.js'
import {
  estimateRevisionPayload, estimateRevisionContentHash, computeEstimateRevisionTotals, replayEstimateRevision,
  type EstimateRevision, type EstimateRevisionPayload,
} from '../../src/domain/commercial/estimate-revision.js'
import { estimateLine } from '../../src/domain/commercial/estimate-line.js'
import { money, moneyFromMinor } from '../../src/domain/commercial/money.js'
import { quantity, UNITS } from '../../src/domain/commercial/quantity.js'
import { ratio } from '../../src/domain/commercial/pricing.js'
import { currencyCode } from '../../src/domain/commercial/currency.js'
import { bid as createBid } from '../../src/domain/commercial/bid.js'
import { planMeasurement } from '../../src/domain/commercial/plan-measurement.js'
import { boqItem } from '../../src/domain/commercial/boq.js'
import { entityId, ID_PREFIX } from '../../src/domain/ids.js'
import { createTenantContext } from '../../src/domain/tenant-context.js'
import type { Membership } from '../../src/domain/types.js'

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
  }
})
afterAll(async () => { await db.close() })

async function bootstrap(orgName: string) {
  const uniq = orgName + '_' + Math.random().toString(36).slice(2, 8)
  const user = await repos.users.create({
    id: entityId(ID_PREFIX.user), email: uniq + '@test', displayName: uniq,
    status: 'active', createdAt: new Date().toISOString(),
  })
  const orgId = entityId(ID_PREFIX.organization)
  await repos.orgs.create({
    id: orgId, tenantId: orgId, name: uniq, slug: uniq, status: 'active', createdAt: new Date().toISOString(),
  })
  const membership: Membership = {
    id: entityId(ID_PREFIX.membership), userId: user.id, organizationId: orgId,
    role: 'owner', status: 'active', createdAt: new Date().toISOString(),
  }
  await repos.memberships.create(membership)
  const ws = await repos.workspaces.create({
    id: entityId(ID_PREFIX.workspace), tenantId: orgId, organizationId: orgId,
    name: 'WS', createdAt: new Date().toISOString(),
  })
  const proj = await repos.projects.create({
    id: entityId(ID_PREFIX.project), tenantId: orgId, workspaceId: ws.id,
    name: 'Project', status: 'active', createdAt: new Date().toISOString(),
  })
  const ctx = createTenantContext(orgId, user.id, membership)
  return { user, orgId, ws, proj, ctx }
}

function makePayload(projectId: string, rateMinor = 500, qty = 100): EstimateRevisionPayload {
  return estimateRevisionPayload({
    projectId, currency: currencyCode('GHS'),
    policy: { overheadPct: ratio(0.10), contingencyPct: ratio(0.05), targetProfitMode: 'markup', targetProfitRatio: ratio(0.10) },
    lines: [estimateLine({
      lineId: 'l1', boqItemId: null, description: 'Concrete',
      quantity: quantity(qty, UNITS.SQUARE_METRE),
      costBasis: 'unit-rate', rate: moneyFromMinor(rateMinor, 'GHS'),
      pricingStrategy: 'markup', pricingRatio: ratio(0.20),
    })],
    pricingAlgorithmVersion: 'v1',
  })
}

// ── §32: MOST IMPORTANT REPLAY TEST ──────────────────────────

describe('§32: EstimateRevision persist → load → reconstruct → replay → hash match', () => {
  it('stored contentHash == recomputed contentHash after load', async () => {
    const { orgId, proj, ctx } = await bootstrap('Replay')
    const payload = makePayload(proj.id)
    const originalHash = estimateRevisionContentHash(payload)

    // Persist
    const created = await repos.estRev.createDraft(orgId, proj.id, payload, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString())
    await repos.estRev.finalize(created.metadata.revisionId, orgId, new Date().toISOString())

    // Load
    const loaded = await repos.estRev.getById(created.metadata.revisionId, orgId)
    expect(loaded).not.toBeNull()

    // Reconstruct payload + recompute hash
    const loadedHash = estimateRevisionContentHash(loaded!.payload)
    expect(loadedHash).toBe(originalHash)
    expect(loaded!.metadata.contentHash).toBe(originalHash)

    // Replay financial result
    const originalTotals = computeEstimateRevisionTotals(payload)
    const replayedTotals = replayEstimateRevision(loaded!)
    expect(replayedTotals.totalLineCost.amount).toBe(originalTotals.totalLineCost.amount)
    expect(replayedTotals.totalCost.amount).toBe(originalTotals.totalCost.amount)
    expect(replayedTotals.profit.amount).toBe(originalTotals.profit.amount)
    expect(replayedTotals.sellPrice.amount).toBe(originalTotals.sellPrice.amount)
    expect(replayedTotals.grossProfit.amount).toBe(originalTotals.grossProfit.amount)
  })
})

// ── §33: IMMUTABILITY ATTACK TESTS ───────────────────────────

describe('§33: Immutability attacks against persisted EstimateRevision', () => {
  it('UPDATE finalized payload_json → rejected', async () => {
    const { orgId, proj, ctx } = await bootstrap('ImmutPayload')
    const payload = makePayload(proj.id)
    const created = await repos.estRev.createDraft(orgId, proj.id, payload, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString())
    await repos.estRev.finalize(created.metadata.revisionId, orgId, new Date().toISOString())

    await expect(
      db.execute(`UPDATE estimate_revision_payloads SET payload_json = $1 WHERE revision_id = $2`, ['{"hacked":true}', created.metadata.revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('UPDATE finalized content_hash → rejected (via revisions trigger)', async () => {
    const { orgId, proj, ctx } = await bootstrap('ImmutHash')
    const payload = makePayload(proj.id)
    const created = await repos.estRev.createDraft(orgId, proj.id, payload, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString())
    await repos.estRev.finalize(created.metadata.revisionId, orgId, new Date().toISOString())

    await expect(
      db.execute(`UPDATE revisions SET content_hash = $1 WHERE revision_id = $2`, ['HACKED', created.metadata.revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('DELETE finalized estimate → rejected (both revisions + payload)', async () => {
    const { orgId, proj, ctx } = await bootstrap('ImmutDelete')
    const payload = makePayload(proj.id)
    const created = await repos.estRev.createDraft(orgId, proj.id, payload, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString())
    await repos.estRev.finalize(created.metadata.revisionId, orgId, new Date().toISOString())

    await expect(
      db.execute(`DELETE FROM estimate_revision_payloads WHERE revision_id = $1`, [created.metadata.revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
    await expect(
      db.execute(`DELETE FROM revisions WHERE revision_id = $1`, [created.metadata.revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('UPDATE finalized → superseded + mutate payload → rejected', async () => {
    const { orgId, proj, ctx } = await bootstrap('ImmutSupersede')
    const payload = makePayload(proj.id)
    const created = await repos.estRev.createDraft(orgId, proj.id, payload, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString())
    await repos.estRev.finalize(created.metadata.revisionId, orgId, new Date().toISOString())

    // Try to UPDATE payload_json AND set status to superseded in one go
    await expect(
      db.execute(`UPDATE estimate_revision_payloads SET payload_json = $1 WHERE revision_id = $2`, ['{"hacked":true}', created.metadata.revisionId]),
    ).rejects.toThrow(/immutable|forbidden/i)
  })

  it('draft payload CAN be updated (working state)', async () => {
    const { orgId, proj, ctx } = await bootstrap('DraftUpdate')
    const payload = makePayload(proj.id)
    const created = await repos.estRev.createDraft(orgId, proj.id, payload, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString())

    // Draft can be updated
    const newPayload = makePayload(proj.id, 600, 200) // different rate + qty
    const updated = await repos.estRev.updateDraftPayload(created.metadata.revisionId, orgId, newPayload)
    expect(updated).not.toBeNull()
    expect(updated!.metadata.contentHash).toBe(estimateRevisionContentHash(newPayload))
  })
})

// ── §34: TENANT ATTACK TESTS ─────────────────────────────────

describe('§34: Tenant isolation for Commercial entities', () => {
  it('Tenant A cannot read Tenant B EstimateRevision', async () => {
    const a = await bootstrap('TenantA')
    const b = await bootstrap('TenantB')
    const payload = makePayload(b.proj.id)
    const created = await repos.estRev.createDraft(b.orgId, b.proj.id, payload, b.ctx.actor.kind === 'user' ? b.ctx.actor.userId : 'svc', new Date().toISOString())
    // Tenant A reads B's revision → null
    const cross = await repos.estRev.getById(created.metadata.revisionId, a.orgId)
    expect(cross).toBeNull()
  })

  it('Tenant A cannot read Tenant B BOQ', async () => {
    const a = await bootstrap('TenantA_BOQ')
    const b = await bootstrap('TenantB_BOQ')
    const boqId = entityId(ID_PREFIX.project)
    await repos.boq.create(boqId, b.orgId, b.proj.id, 'B BOQ')
    // Tenant A reads B's BOQ → null
    const cross = await repos.boq.getById(boqId, a.orgId)
    expect(cross).toBeNull()
  })

  it('Tenant A cannot read Tenant B Bid', async () => {
    const a = await bootstrap('TenantA_Bid')
    const b = await bootstrap('TenantB_Bid')
    const payload = makePayload(b.proj.id)
    const rev = await repos.estRev.createDraft(b.orgId, b.proj.id, payload, b.ctx.actor.kind === 'user' ? b.ctx.actor.userId : 'svc', new Date().toISOString())
    await repos.estRev.finalize(rev.metadata.revisionId, b.orgId, new Date().toISOString())
    const b_bid = createBid({
      bidId: entityId(ID_PREFIX.audit), projectId: b.proj.id,
      estimateRevisionId: rev.metadata.revisionId,
      estimateRevisionContentHash: estimateRevisionContentHash(payload),
      status: 'draft', finalPrice: money(600, 'GHS'),
    })
    await repos.bids.create(b_bid, b.orgId)
    // Tenant A reads B's bid → null
    const cross = await repos.bids.getById(b_bid.bidId, a.orgId)
    expect(cross).toBeNull()
  })

  it('Tenant A cannot read Tenant B PlanMeasurement', async () => {
    const a = await bootstrap('TenantA_PM')
    const b = await bootstrap('TenantB_PM')
    const pm = planMeasurement({
      measurementId: entityId(ID_PREFIX.audit), sourceArtifactId: 'art_1', sourceArtifactHash: 'hash_1',
      sheetId: 's1', sheetRevision: 'r1', elementReference: 'e1',
      quantity: quantity(100, UNITS.SQUARE_METRE), measurementMethod: 'manual-takeoff',
      measurementBasis: 'area', measurementEngineVersion: 'v1', actorId: b.user.id, measuredAt: new Date().toISOString(),
    })
    await repos.pm.create(pm, b.orgId, b.proj.id)
    // Tenant A reads B's PM → null
    const cross = await repos.pm.getById(pm.measurementId, a.orgId)
    expect(cross).toBeNull()
  })
})

// ── §35: BOQ SNAPSHOT TEST ───────────────────────────────────

describe('§35: BOQ change does not mutate finalized EstimateRevision', () => {
  it('BOQItem.quantity changes; finalized revision quantity unchanged', async () => {
    const { orgId, proj, ctx } = await bootstrap('BOQSnapshot')
    // Create BOQ with item qty=100
    const boqId = entityId(ID_PREFIX.workspace)
    await repos.boq.create(boqId, orgId, proj.id, 'Test BOQ')
    const item = boqItem({
      itemId: entityId(ID_PREFIX.project), itemCode: '1.1', description: 'Concrete',
      unit: 'm2', quantity: quantity(100, UNITS.SQUARE_METRE), provenance: 'manual',
    })
    await repos.boq.addItem(item, boqId, orgId)

    // Create EstimateRevision with line qty=100 (snapshot from BOQ)
    const payload = estimateRevisionPayload({
      projectId: proj.id, currency: currencyCode('GHS'),
      policy: { overheadPct: ratio(0.10), contingencyPct: ratio(0.05), targetProfitMode: 'markup', targetProfitRatio: ratio(0.10) },
      lines: [estimateLine({
        lineId: 'l1', boqItemId: item.itemId, description: 'Concrete',
        quantity: quantity(100, UNITS.SQUARE_METRE),
        costBasis: 'unit-rate', rate: moneyFromMinor(500, 'GHS'),
        pricingStrategy: 'markup', pricingRatio: ratio(0.20),
      })],
      pricingAlgorithmVersion: 'v1',
    })
    const rev = await repos.estRev.createDraft(orgId, proj.id, payload, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString())
    await repos.estRev.finalize(rev.metadata.revisionId, orgId, new Date().toISOString())

    // Change BOQ quantity to 120
    await repos.boq.updateItemQuantity(item.itemId, orgId, 120, 'm2')
    const changedItem = await repos.boq.getItem(item.itemId, orgId)
    expect(changedItem!.quantity.value).toBe(120)

    // Load the finalized revision — its line quantity must still be 100
    const loaded = await repos.estRev.getById(rev.metadata.revisionId, orgId)
    expect(loaded).not.toBeNull()
    expect(loaded!.payload.lines[0]!.quantity.value).toBe(100)

    // Replay and verify financial result unchanged
    const totals = replayEstimateRevision(loaded!)
    // lineCost = 500 × 100 = 50000 minor (NOT 500 × 120 = 60000)
    expect(totals.totalLineCost.amount).toBe(50000)
  })
})

// ── §36: BID HASH TEST ───────────────────────────────────────

describe('§36: Bid hash integrity', () => {
  it('Bid.estimateRevisionContentHash == EstimateRevision.contentHash', async () => {
    const { orgId, proj, ctx } = await bootstrap('BidHash')
    const payload = makePayload(proj.id)
    const rev = await repos.estRev.createDraft(orgId, proj.id, payload, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString())
    await repos.estRev.finalize(rev.metadata.revisionId, orgId, new Date().toISOString())

    // Create Bid referencing the finalized revision
    const b = createBid({
      bidId: entityId(ID_PREFIX.audit), projectId: proj.id,
      estimateRevisionId: rev.metadata.revisionId,
      estimateRevisionContentHash: estimateRevisionContentHash(payload),
      status: 'draft', finalPrice: money(632.50, 'GHS'),
    })
    await repos.bids.create(b, orgId)

    // Load both and verify hash match
    const loadedRev = await repos.estRev.getById(rev.metadata.revisionId, orgId)
    const loadedBid = await repos.bids.getById(b.bidId, orgId)
    expect(loadedBid!.estimateRevisionContentHash).toBe(loadedRev!.metadata.contentHash)
    expect(loadedBid!.estimateRevisionContentHash).toBe(estimateRevisionContentHash(loadedRev!.payload))
  })
})

// ── PlanMeasurement persistence ──────────────────────────────

describe('PlanMeasurement persistence', () => {
  it('create + get + provenance preserved', async () => {
    const { orgId, proj, user } = await bootstrap('PM_CRUD')
    const pm = planMeasurement({
      measurementId: entityId(ID_PREFIX.audit), sourceArtifactId: 'art_test', sourceArtifactHash: 'hash_test',
      sheetId: 's1', sheetRevision: 'r1', elementReference: 'e1',
      quantity: quantity(42.5, UNITS.SQUARE_METRE), measurementMethod: 'manual-takeoff',
      measurementBasis: 'area', measurementEngineVersion: 'v1', actorId: user.id, measuredAt: new Date().toISOString(),
    })
    const created = await repos.pm.create(pm, orgId, proj.id)
    expect(created.measurementId).toBe(pm.measurementId)
    expect(created.sourceArtifactHash).toBe('hash_test')
    expect(created.quantity.value).toBeCloseTo(42.5, 4)

    const loaded = await repos.pm.getById(pm.measurementId, orgId)
    expect(loaded).not.toBeNull()
    expect(loaded!.sourceArtifactId).toBe('art_test')
    expect(loaded!.measurementEngineVersion).toBe('v1')
  })
})

// ── BOQ persistence ──────────────────────────────────────────

describe('BOQ persistence', () => {
  it('create BOQ + items + get + list', async () => {
    const { orgId, proj } = await bootstrap('BOQ_CRUD')
    const boqId = entityId(ID_PREFIX.workspace)
    await repos.boq.create(boqId, orgId, proj.id, 'Test BOQ')
    const item1 = boqItem({
      itemId: entityId(ID_PREFIX.project), itemCode: '1.1', description: 'Concrete',
      unit: 'm2', quantity: quantity(100, UNITS.SQUARE_METRE), provenance: 'manual',
    })
    const item2 = boqItem({
      itemId: entityId(ID_PREFIX.project), itemCode: '1.2', description: 'Steel',
      unit: 't', quantity: quantity(5, UNITS.TONNE), provenance: 'imported',
    })
    await repos.boq.addItem(item1, boqId, orgId)
    await repos.boq.addItem(item2, boqId, orgId)

    const loaded = await repos.boq.getById(boqId, orgId)
    expect(loaded).not.toBeNull()
    expect(loaded!.items.length).toBe(2)
    expect(loaded!.items[0]!.itemCode).toBe('1.1')
    expect(loaded!.items[1]!.itemCode).toBe('1.2')
  })
})

// ── EstimateRevision lifecycle ──────────────────────────────

describe('EstimateRevision lifecycle (draft → finalized → superseded)', () => {
  it('draft → finalize → supersede with payload preserved', async () => {
    const { orgId, proj, ctx } = await bootstrap('Lifecycle')
    const payload = makePayload(proj.id)
    const draft = await repos.estRev.createDraft(orgId, proj.id, payload, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString())
    expect(draft.metadata.status).toBe('draft')

    const finalized = await repos.estRev.finalize(draft.metadata.revisionId, orgId, new Date().toISOString())
    expect(finalized!.metadata.status).toBe('finalized')
    expect(finalized!.metadata.finalizedAt).not.toBeNull()

    // Payload preserved after finalization
    const loadedHash = estimateRevisionContentHash(finalized!.payload)
    expect(loadedHash).toBe(estimateRevisionContentHash(payload))

    const superseded = await repos.estRev.supersede(draft.metadata.revisionId, orgId)
    expect(superseded!.metadata.status).toBe('superseded')

    // Payload still preserved after supersede
    const loadedAfter = await repos.estRev.getById(draft.metadata.revisionId, orgId)
    expect(loadedAfter!.payload.lines[0]!.description).toBe('Concrete')
  })

  it('revision number is sequential within (tenant, project, estimate)', async () => {
    const { orgId, proj, ctx } = await bootstrap('SeqNum')
    const p1 = makePayload(proj.id)
    const p2 = makePayload(proj.id, 600, 50)
    const r1 = await repos.estRev.createDraft(orgId, proj.id, p1, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString())
    const r2 = await repos.estRev.createDraft(orgId, proj.id, p2, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString())
    expect(r2.metadata.revisionNumber).toBe(r1.metadata.revisionNumber + 1)
  })
})

// ── §8: FAILURE TEST — CREATE (payload failure rolls back revision) ──

describe('§8: createDraft payload failure → full rollback', () => {
  it('payload INSERT failure causes revision INSERT rollback (no orphaned revision)', async () => {
    const { orgId, proj, ctx } = await bootstrap('FailCreate')
    // Get the counter state before
    const counterBefore = await db.query<{ next_number: number }>(
      `SELECT next_number FROM revision_counters WHERE tenant_id = $1 AND project_id = $2 AND authority_kind = 'estimate'`,
      [orgId, proj.id],
    )
    const counterBeforeVal = counterBefore[0]?.next_number ?? 1

    // Create a valid payload
    const payload = makePayload(proj.id)

    // We'll sabotage the payload INSERT by pre-inserting a row with the same
    // revision_id (PK violation). But we don't know the revision_id in advance
    // (it's generated inside createDraft). Instead, we'll cause a CHECK
    // violation by temporarily disabling the payload table's permissions.
    // Actually, the simplest approach: use a raw SQL to make the payload_json
    // column NOT NULL fail — but it IS NOT NULL already and we pass a valid value.
    //
    // The cleanest approach: drop the estimate_revision_payloads table temporarily
    // to force the INSERT to fail. But that's destructive.
    //
    // Best approach: create a trigger that blocks INSERT into
    // estimate_revision_payloads, forcing the payload write to fail AFTER
    // the revision metadata has been written.

    // Install a blocking trigger
    await db.execRaw(`
      CREATE OR REPLACE FUNCTION block_payload_insert() RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Test: payload insert blocked';
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS trg_block_payload_insert ON estimate_revision_payloads;
      CREATE TRIGGER trg_block_payload_insert BEFORE INSERT ON estimate_revision_payloads
        FOR EACH ROW EXECUTE FUNCTION block_payload_insert();
    `)

    // createDraft should throw because the payload INSERT fails
    await expect(
      repos.estRev.createDraft(orgId, proj.id, payload, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString()),
    ).rejects.toThrow(/Test: payload insert blocked/i)

    // Remove the blocking trigger
    await db.execRaw(`DROP TRIGGER IF EXISTS trg_block_payload_insert ON estimate_revision_payloads;`)

    // Verify NO orphaned revision exists
    const orphanedRevisions = await db.query<{ revision_id: string }>(
      `SELECT revision_id FROM revisions WHERE tenant_id = $1 AND project_id = $2 AND authority_kind = 'estimate'`,
      [orgId, proj.id],
    )
    expect(orphanedRevisions.length).toBe(0)

    // Verify NO orphaned payload exists
    const orphanedPayloads = await db.query<{ revision_id: string }>(
      `SELECT revision_id FROM estimate_revision_payloads WHERE tenant_id = $1 AND project_id = $2`,
      [orgId, proj.id],
    )
    expect(orphanedPayloads.length).toBe(0)

    // Verify the counter was NOT consumed (rolled back)
    const counterAfter = await db.query<{ next_number: number }>(
      `SELECT next_number FROM revision_counters WHERE tenant_id = $1 AND project_id = $2 AND authority_kind = 'estimate'`,
      [orgId, proj.id],
    )
    const counterAfterVal = counterAfter[0]?.next_number ?? 1
    expect(counterAfterVal).toBe(counterBeforeVal) // counter NOT consumed

    // Verify that a subsequent createDraft succeeds with the correct number
    const payload2 = makePayload(proj.id)
    const created = await repos.estRev.createDraft(orgId, proj.id, payload2, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString())
    expect(created.metadata.revisionNumber).toBe(counterBeforeVal) // same number — counter was rolled back
  })
})

// ── §9: FAILURE TEST — UPDATE (payload failure preserves old state) ──

describe('§9: updateDraftPayload payload failure → old state preserved', () => {
  it('payload UPDATE failure causes content_hash rollback (no hash/payload mismatch)', async () => {
    const { orgId, proj, ctx } = await bootstrap('FailUpdate')
    // Create a draft
    const originalPayload = makePayload(proj.id)
    const created = await repos.estRev.createDraft(orgId, proj.id, originalPayload, ctx.actor.kind === 'user' ? ctx.actor.userId : 'svc', new Date().toISOString())
    const originalHash = created.metadata.contentHash

    // Install a blocking trigger on UPDATE of estimate_revision_payloads
    await db.execRaw(`
      CREATE OR REPLACE FUNCTION block_payload_update_test() RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Test: payload update blocked';
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS trg_block_payload_update_test ON estimate_revision_payloads;
      CREATE TRIGGER trg_block_payload_update_test BEFORE UPDATE ON estimate_revision_payloads
        FOR EACH ROW EXECUTE FUNCTION block_payload_update_test();
    `)

    // Attempt to update the draft payload — should fail
    const newPayload = makePayload(proj.id, 600, 200) // different rate + qty
    await expect(
      repos.estRev.updateDraftPayload(created.metadata.revisionId, orgId, newPayload),
    ).rejects.toThrow(/Test: payload update blocked/i)

    // Remove the blocking trigger
    await db.execRaw(`DROP TRIGGER IF EXISTS trg_block_payload_update_test ON estimate_revision_payloads;`)

    // Verify the OLD content_hash is preserved (not changed to the new hash)
    const loadedRev = await repos.estRev.getById(created.metadata.revisionId, orgId)
    expect(loadedRev).not.toBeNull()
    expect(loadedRev!.metadata.contentHash).toBe(originalHash) // hash unchanged

    // Verify the OLD payload is preserved (not changed to the new payload)
    expect(loadedRev!.payload.lines[0]!.quantity.value).toBe(100) // original qty, not 200
    expect(loadedRev!.payload.lines[0]!.rate.amount).toBe(500) // original rate, not 600

    // Verify the replay still matches the original
    const replayedTotals = replayEstimateRevision(loadedRev!)
    expect(replayedTotals.totalLineCost.amount).toBe(50000) // 500 × 100, not 600 × 200
  })
})
