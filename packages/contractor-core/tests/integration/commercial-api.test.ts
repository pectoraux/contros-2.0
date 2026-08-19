/**
 * Commercial API integration tests (Phase 2B.3).
 *
 * End-to-end: HTTP request → CoreApi adapter → application service →
 * transaction (mutation + audit) → repository → REAL PostgreSQL (pglite).
 * NO MOCKS of the database, repositories, transaction, audit, or services.
 *
 * Verifies:
 *  - resource-oriented routes for all 4 Commercial services
 *  - tenant isolation at the HTTP boundary (Tenant A cannot act on Tenant B)
 *  - authorization (viewer/member/owner/no-membership)
 *  - error mapping (401/403/404/400/409/500)
 *  - security (malformed input, cross-tenant IDs, oversized payloads)
 *  - audit atomicity through the API (forced audit failure rolls back)
 *  - full Commercial workflows: estimate→finalize→replay, bid→submit→outcome
 *
 * The API resolves the TenantContext server-side via ApiSessionResolver —
 * the client NEVER supplies tenantId. (Phase 2B.3 §5.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import {
  PgLiteClient, FOUNDATION_MIGRATION_SQL, COMMERCIAL_MIGRATION_SQL, applyMigration,
} from '../../src/persistence/index.js'
import {
  PlanMeasurementRepository, BOQRepository, EstimateRevisionRepository, BidRepository,
  OrganizationRepository, UserRepository, MembershipRepository, WorkspaceRepository,
  ProjectRepository, AuditRepository, RevisionRepository,
} from '../../src/persistence/index.js'
import {
  IdentityService, OrganizationService, WorkspaceService, ProjectService,
  AuditService, RevisionService,
  PlanMeasurementService, BOQService, EstimateService, BidService,
} from '../../src/service/index.js'
import { CoreApi } from '../../src/api/core-api.js'
import type { ApiRequest, ApiResponse, ApiSessionResolver } from '../../src/api/core-api.js'
import type { Membership, Role } from '../../src/domain/types.js'
import { entityId, ID_PREFIX } from '../../src/domain/ids.js'
import { createTenantContext } from '../../src/domain/tenant-context.js'

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
  revisions: RevisionRepository
}
let api: CoreApi

// ── Session resolver: maps a test token to an authenticated session ──────
// Token format: "tok_<userId>::<tenantId>" — resolves to { provider, subject, tenantId }.
// The IdentityService then resolves the user from the auth binding + the membership.
// This is the ONLY authoritative tenant source — the client never supplies tenantId.
const sessionResolver: ApiSessionResolver = {
  async resolveSession(token: string | undefined) {
    if (!token || !token.startsWith('tok_')) return null
    const payload = token.slice(4)
    const [userId, tenantId] = payload.split('::')
    if (!userId || !tenantId) return null
    // The auth binding was created during bootstrap; provider/subject are synthetic.
    return { provider: 'test', subject: userId, tenantId }
  },
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
    revisions: new RevisionRepository(db),
  }

  const identity = new IdentityService(repos.users, repos.memberships)
  const organizations = new OrganizationService(repos.orgs, repos.memberships, repos.audit)
  const workspaces = new WorkspaceService(repos.workspaces, repos.audit)
  const projects = new ProjectService(repos.projects, repos.workspaces, repos.audit)
  const audit = new AuditService(repos.audit)
  const revisions = new RevisionService(repos.revisions, repos.projects, repos.audit)
  const measurements = new PlanMeasurementService(db, repos.pm, repos.projects, repos.audit)
  const boqs = new BOQService(db, repos.boq, repos.projects, repos.audit)
  const estimates = new EstimateService(db, repos.estRev, repos.projects, repos.audit)
  const bids = new BidService(db, repos.bids, repos.estRev, repos.audit)

  api = new CoreApi(
    { identity, organizations, workspaces, projects, audit, revisions, measurements, boqs, estimates, bids },
    sessionResolver,
  )
})
afterAll(async () => { await db.close() })

// ── Helpers ──────────────────────────────────────────────────────────────

async function bootstrap(name: string, role: Role = 'owner') {
  const uniq = name + '_' + Math.random().toString(36).slice(2, 8)
  const user = await repos.users.create({
    id: entityId(ID_PREFIX.user), email: uniq + '@test', displayName: uniq,
    status: 'active', createdAt: new Date().toISOString(),
  })
  const orgId = entityId(ID_PREFIX.organization)
  await repos.orgs.create({
    id: orgId, tenantId: orgId, name: uniq, slug: uniq,
    status: 'active', createdAt: new Date().toISOString(),
  })
  const membership: Membership = {
    id: entityId(ID_PREFIX.membership), userId: user.id, organizationId: orgId,
    role, status: 'active', createdAt: new Date().toISOString(),
  }
  await repos.memberships.create(membership)
  // Bind the synthetic auth provider so IdentityService can authenticate the token
  await repos.users.createBinding({
    id: entityId(ID_PREFIX.authBinding), userId: user.id, provider: 'test', subject: user.id,
    createdAt: new Date().toISOString(), lastUsedAt: null,
  })
  const ws = await repos.workspaces.create({
    id: entityId(ID_PREFIX.workspace), tenantId: orgId, organizationId: orgId,
    name: 'WS', createdAt: new Date().toISOString(),
  })
  const proj = await repos.projects.create({
    id: entityId(ID_PREFIX.project), tenantId: orgId, workspaceId: ws.id,
    name: 'Project', status: 'active', createdAt: new Date().toISOString(),
  })
  const ctx = createTenantContext(orgId, user.id, membership)
  const token = `tok_${user.id}::${orgId}`
  return { user, orgId, wsId: ws.id, projId: proj.id, ctx, token, membership }
}

function req(method: string, path: string, token: string, body?: unknown): ApiRequest {
  return { method, path, headers: { authorization: `Bearer ${token}` }, body: body ?? null }
}

function makePayload(projectId: string, rateMinor = 500, qty = 100) {
  return {
    projectId,
    currency: 'GHS',
    policy: {
      overheadPct: 0.10, contingencyPct: 0.05,
      targetProfitMode: 'markup', targetProfitRatio: 0.10,
    },
    lines: [{
      lineId: 'l1', boqItemId: null, description: 'Concrete',
      quantityValue: qty, quantityUnit: 'm2',
      costBasis: 'unit-rate', rateMinor,
      pricingStrategy: 'markup', pricingRatio: 0.20,
    }],
    note: null,
    pricingAlgorithmVersion: 'v1',
  }
}

async function createFinalizedEstimate(token: string, projId: string) {
  const r = await api.handle(req('POST', `/projects/${projId}/estimates`, token, makePayload(projId)))
  const rid = (r.body as { revisionId: string }).revisionId
  const f = await api.handle(req('POST', `/estimates/${rid}/finalize`, token))
  return f.body as { revisionId: string; status: string; contentHash: string }
}

// ════════════════════════════════════════════════════════════════════════
// §1 Estimate API — create → update → finalize → supersede → replay
// ════════════════════════════════════════════════════════════════════════

describe('Estimate API', () => {
  it('POST /projects/:projectId/estimates creates a draft; GET returns it', async () => {
    const { projId, token, orgId } = await bootstrap('API_Est_Create')
    const r = await api.handle(req('POST', `/projects/${projId}/estimates`, token, makePayload(projId)))
    expect(r.status).toBe(200)
    const body = r.body as Record<string, unknown>
    expect(body.status).toBe('draft')
    expect(body.authorityKind).toBe('estimate')
    expect(body.revisionNumber).toBeGreaterThanOrEqual(1)
    expect(body.contentHash).toBeDefined()
    expect(body.tenantId).toBe(orgId)
    const rid = body.revisionId as string

    // GET single
    const g = await api.handle(req('GET', `/estimates/${rid}`, token))
    expect(g.status).toBe(200)
    expect((g.body as { revisionId: string }).revisionId).toBe(rid)

    // GET list
    const list = await api.handle(req('GET', `/projects/${projId}/estimates`, token))
    expect(list.status).toBe(200)
    expect((list.body as unknown[]).length).toBe(1)
  })

  it('PATCH /estimates/:revisionId updates a draft; contentHash changes', async () => {
    const { projId, token } = await bootstrap('API_Est_Update')
    const r = await api.handle(req('POST', `/projects/${projId}/estimates`, token, makePayload(projId)))
    const rid = (r.body as { revisionId: string }).revisionId
    const oldHash = (r.body as { contentHash: string }).contentHash

    const newPayload = makePayload(projId, 9999, 7)
    const u = await api.handle(req('PATCH', `/estimates/${rid}`, token, newPayload))
    expect(u.status).toBe(200)
    const updated = u.body as { contentHash: string; payload: { lines: { description: string }[] } }
    expect(updated.contentHash).not.toBe(oldHash)
    expect(updated.payload.lines[0]!.description).toBe('Concrete')
  })

  it('POST /estimates/:revisionId/finalize → finalized; POST supersede → superseded', async () => {
    const { projId, token } = await bootstrap('API_Est_FinSup')
    const r = await api.handle(req('POST', `/projects/${projId}/estimates`, token, makePayload(projId)))
    const rid = (r.body as { revisionId: string }).revisionId

    const f = await api.handle(req('POST', `/estimates/${rid}/finalize`, token))
    expect(f.status).toBe(200)
    expect((f.body as { status: string }).status).toBe('finalized')

    const s = await api.handle(req('POST', `/estimates/${rid}/supersede`, token))
    expect(s.status).toBe(200)
    expect((s.body as { status: string }).status).toBe('superseded')
  })

  it('GET /estimates/:revisionId/replay returns derived totals (API does NOT compute them)', async () => {
    const { projId, token } = await bootstrap('API_Est_Replay')
    const finalized = await createFinalizedEstimate(token, projId)

    const r = await api.handle(req('GET', `/estimates/${finalized.revisionId}/replay`, token))
    expect(r.status).toBe(200)
    const body = r.body as { contentHashMatches: boolean; totals: { totalLineCost: { amount: number }; sellPrice: { amount: number }; grossMargin: number } }
    expect(body.contentHashMatches).toBe(true)
    // 500 × 100 = 50000 minor line cost; totals supplied by the service (replayEstimate)
    expect(body.totals.totalLineCost.amount).toBe(50000)
    expect(body.totals.sellPrice.amount).toBeGreaterThan(body.totals.totalLineCost.amount)
    expect(typeof body.totals.grossMargin).toBe('number')
  })

  it('finalize on already-finalized → 409 ConflictError', async () => {
    const { projId, token } = await bootstrap('API_Est_DoubleFin')
    const finalized = await createFinalizedEstimate(token, projId)
    const r = await api.handle(req('POST', `/estimates/${finalized.revisionId}/finalize`, token))
    expect(r.status).toBe(409)
    expect((r.body as { error: string }).error).toBe('conflict')
  })
})

// ════════════════════════════════════════════════════════════════════════
// §2 Bid API — create → submit → outcome → withdraw
// ════════════════════════════════════════════════════════════════════════

describe('Bid API', () => {
  it('POST bid → GET bid → POST submit → POST outcome; submittedAt/outcomeAt persisted', async () => {
    const { projId, token } = await bootstrap('API_Bid_Full')
    const finalized = await createFinalizedEstimate(token, projId)

    // POST bid (finalPrice = 700 GHS = 70000 minor)
    const r = await api.handle(req('POST', `/projects/${projId}/bids`, token, {
      estimateRevisionId: finalized.revisionId,
      finalPrice: { amount: 70000, currency: 'GHS' },
    }))
    expect(r.status).toBe(200)
    const bid = r.body as { bidId: string; status: string; submittedAt: string | null; finalPrice: { amount: number } }
    expect(bid.status).toBe('draft')
    expect(bid.submittedAt).toBeNull()
    expect(bid.finalPrice.amount).toBe(70000)

    // GET bid
    const g = await api.handle(req('GET', `/bids/${bid.bidId}`, token))
    expect(g.status).toBe(200)

    // POST submit → submitted + submittedAt set
    const s = await api.handle(req('POST', `/bids/${bid.bidId}/submit`, token))
    expect(s.status).toBe(200)
    const submitted = s.body as { status: string; submittedAt: string | null }
    expect(submitted.status).toBe('submitted')
    expect(submitted.submittedAt).not.toBeNull()

    // POST outcome → won + outcomeAt + outcomeNote preserved
    const o = await api.handle(req('POST', `/bids/${bid.bidId}/outcome`, token, {
      outcome: 'won', note: 'Awarded to contractor',
    }))
    expect(o.status).toBe(200)
    const won = o.body as { status: string; outcomeAt: string | null; outcomeNote: string | null }
    expect(won.status).toBe('won')
    expect(won.outcomeAt).not.toBeNull()
    expect(won.outcomeNote).toBe('Awarded to contractor')
  })

  it('submit on draft revision → 400 ValidationError', async () => {
    const { projId, token } = await bootstrap('API_Bid_DraftEst')
    // Create a DRAFT estimate (not finalized)
    const r = await api.handle(req('POST', `/projects/${projId}/estimates`, token, makePayload(projId)))
    const draftRevId = (r.body as { revisionId: string }).revisionId

    // Bid referencing draft revision is allowed at create time
    const b = await api.handle(req('POST', `/projects/${projId}/bids`, token, {
      estimateRevisionId: draftRevId,
      finalPrice: { amount: 10000, currency: 'GHS' },
    }))
    const bidId = (b.body as { bidId: string }).bidId

    // But submission fails: revision not finalized → 400
    const s = await api.handle(req('POST', `/bids/${bidId}/submit`, token))
    expect(s.status).toBe(400)
    expect((s.body as { error: string }).error).toBe('validation')
  })

  it('withdraw on terminal (won) → 409 ConflictError', async () => {
    const { projId, token } = await bootstrap('API_Bid_WdTerm')
    const finalized = await createFinalizedEstimate(token, projId)
    const b = await api.handle(req('POST', `/projects/${projId}/bids`, token, {
      estimateRevisionId: finalized.revisionId,
      finalPrice: { amount: 70000, currency: 'GHS' },
    }))
    const bidId = (b.body as { bidId: string }).bidId
    await api.handle(req('POST', `/bids/${bidId}/submit`, token))
    await api.handle(req('POST', `/bids/${bidId}/outcome`, token, { outcome: 'won' }))

    const w = await api.handle(req('POST', `/bids/${bidId}/withdraw`, token))
    expect(w.status).toBe(409)
  })
})

// ════════════════════════════════════════════════════════════════════════
// §3 BOQ API — create → list → add item → update quantity
// ════════════════════════════════════════════════════════════════════════

describe('BOQ API', () => {
  it('full BOQ workflow; audit emitted via service', async () => {
    const { projId, orgId, token } = await bootstrap('API_BOQ_Full')
    const r = await api.handle(req('POST', `/projects/${projId}/boqs`, token, { name: 'Test BOQ' }))
    expect(r.status).toBe(200)
    const boqId = (r.body as { boqId: string }).boqId

    // GET boq
    const g = await api.handle(req('GET', `/boqs/${boqId}`, token))
    expect(g.status).toBe(200)

    // list
    const list = await api.handle(req('GET', `/projects/${projId}/boqs`, token))
    expect((list.body as unknown[]).length).toBe(1)

    // add item
    const item = await api.handle(req('POST', `/boqs/${boqId}/items`, token, {
      itemCode: '1.1', description: 'Concrete', unit: 'm2',
      quantityValue: 100, quantityUnit: 'm2', provenance: 'manual',
    }))
    expect(item.status).toBe(200)
    const itemId = (item.body as { itemId: string }).itemId

    // get items
    const items = await api.handle(req('GET', `/boqs/${boqId}/items`, token))
    expect((items.body as unknown[]).length).toBe(1)

    // update quantity
    const upd = await api.handle(req('PATCH', `/boq-items/${itemId}/quantity`, token, {
      quantityValue: 120, quantityUnit: 'm2',
    }))
    expect(upd.status).toBe(200)
    expect((upd.body as { updated: boolean }).updated).toBe(true)

    // verify audit emitted (via service → audit_events; not via the API)
    const auditEvents = await repos.audit.listForEntity(orgId, 'boq', boqId, 50)
    expect(auditEvents.filter((e) => e.action === 'boq.created')).toHaveLength(1)
    const itemEvents = await repos.audit.listForEntity(orgId, 'boq_item', itemId, 50)
    expect(itemEvents.filter((e) => e.action === 'boq.item_added')).toHaveLength(1)
    expect(itemEvents.filter((e) => e.action === 'boq.item_quantity_updated')).toHaveLength(1)
  })
})

// ════════════════════════════════════════════════════════════════════════
// §4 PlanMeasurement API — create → read → list
// ════════════════════════════════════════════════════════════════════════

describe('PlanMeasurement API', () => {
  it('POST measurement → GET single → GET list; all provenance fields preserved; NO pricing fields', async () => {
    const { projId, token } = await bootstrap('API_PM_Full')
    const r = await api.handle(req('POST', `/projects/${projId}/measurements`, token, {
      sourceArtifactId: 'art_test', sourceArtifactHash: 'hash_test',
      sheetId: 's1', sheetRevision: 'r1', elementReference: 'e1',
      quantityValue: 42.5, quantityUnit: 'm2',
      measurementMethod: 'manual-takeoff', measurementBasis: 'area',
      measurementEngineVersion: 'v1',
    }))
    expect(r.status).toBe(200)
    const body = r.body as Record<string, unknown>
    expect(body.measurementId).toBeDefined()
    expect(body.sourceArtifactId).toBe('art_test')
    expect(body.sourceArtifactHash).toBe('hash_test')
    expect(body.sheetId).toBe('s1')
    expect(body.sheetRevision).toBe('r1')
    expect(body.elementReference).toBe('e1')
    expect((body.quantity as { value: number }).value).toBeCloseTo(42.5, 4)
    expect((body.quantity as { unit: string }).unit).toBe('m2')
    expect(body.measurementMethod).toBe('manual-takeoff')
    expect(body.measurementBasis).toBe('area')
    expect(body.measurementEngineVersion).toBe('v1')
    expect(body.provisional).toBe(false)
    // CRITICAL: NO pricing fields
    expect('rate' in body || 'price' in body || 'finalPrice' in body).toBe(false)

    const mid = body.measurementId as string
    const g = await api.handle(req('GET', `/measurements/${mid}`, token))
    expect(g.status).toBe(200)
    expect((g.body as { measurementId: string }).measurementId).toBe(mid)

    const list = await api.handle(req('GET', `/projects/${projId}/measurements`, token))
    expect((list.body as unknown[]).length).toBe(1)
  })
})

// ════════════════════════════════════════════════════════════════════════
// §5 Tenant isolation at the HTTP boundary
// ════════════════════════════════════════════════════════════════════════

describe('API Tenant isolation', () => {
  it('Tenant A cannot GET Tenant B Estimate → 404 (existence not leaked)', async () => {
    const a = await bootstrap('API_TenantIso_Est_A')
    const b = await bootstrap('API_TenantIso_Est_B')
    const r = await api.handle(req('POST', `/projects/${a.projId}/estimates`, a.token, makePayload(a.projId)))
    const rid = (r.body as { revisionId: string }).revisionId

    const g = await api.handle(req('GET', `/estimates/${rid}`, b.token))
    expect(g.status).toBe(404)
    expect((g.body as { error: string }).error).toBe('not_found')
  })

  it('Tenant A cannot GET/submit/update Tenant B BOQ/Bid/Measurement', async () => {
    const a = await bootstrap('API_TenantIso_Cross_A')
    const b = await bootstrap('API_TenantIso_Cross_B')
    // Tenant A creates resources
    const finalized = await createFinalizedEstimate(a.token, a.projId)
    const boqR = await api.handle(req('POST', `/projects/${a.projId}/boqs`, a.token, { name: 'A BOQ' }))
    const boqId = (boqR.body as { boqId: string }).boqId
    const bidR = await api.handle(req('POST', `/projects/${a.projId}/bids`, a.token, {
      estimateRevisionId: finalized.revisionId, finalPrice: { amount: 70000, currency: 'GHS' },
    }))
    const bidId = (bidR.body as { bidId: string }).bidId
    const pmR = await api.handle(req('POST', `/projects/${a.projId}/measurements`, a.token, {
      sourceArtifactId: 'art', sourceArtifactHash: 'h', sheetId: null, sheetRevision: null,
      elementReference: 'el', quantityValue: 1, quantityUnit: 'm2',
      measurementMethod: 'manual-takeoff', measurementBasis: 'count', measurementEngineVersion: 'v1',
    }))
    const mid = (pmR.body as { measurementId: string }).measurementId

    // Tenant B cannot access any of Tenant A's resources → 404 (existence not leaked)
    expect((await api.handle(req('GET', `/boqs/${boqId}`, b.token))).status).toBe(404)
    expect((await api.handle(req('GET', `/bids/${bidId}`, b.token))).status).toBe(404)
    expect((await api.handle(req('GET', `/measurements/${mid}`, b.token))).status).toBe(404)
    // Tenant B cannot submit Tenant A's bid
    expect((await api.handle(req('POST', `/bids/${bidId}/submit`, b.token))).status).toBe(404)
    // Tenant B cannot create a measurement in Tenant A's project (project existence not leaked → 404)
    expect((await api.handle(req('POST', `/projects/${a.projId}/measurements`, b.token, {
      sourceArtifactId: 'x', sourceArtifactHash: 'x', sheetId: null, sheetRevision: null,
      elementReference: 'x', quantityValue: 1, quantityUnit: 'm2',
      measurementMethod: 'manual-takeoff', measurementBasis: 'count', measurementEngineVersion: 'v1',
    }))).status).toBe(404)
  })
})

// ════════════════════════════════════════════════════════════════════════
// §6 Authorization at the API boundary
// ════════════════════════════════════════════════════════════════════════

describe('API Authorization', () => {
  it('viewer: can read; CANNOT create/finalize/submit (403)', async () => {
    const { projId, token } = await bootstrap('API_Auth_Viewer', 'viewer')
    // read allowed
    const list = await api.handle(req('GET', `/projects/${projId}/estimates`, token))
    expect(list.status).toBe(200)
    // create denied → 403
    const c = await api.handle(req('POST', `/projects/${projId}/estimates`, token, makePayload(projId)))
    expect(c.status).toBe(403)
    expect((c.body as { error: string }).error).toBe('unauthorized')
    // Zero writes occurred (no estimate created)
    const all = await api.handle(req('GET', `/projects/${projId}/estimates`, token))
    expect((all.body as unknown[]).length).toBe(0)
  })

  it('member: can create drafts; CANNOT finalize (403)', async () => {
    const { projId, token } = await bootstrap('API_Auth_Member', 'member')
    const c = await api.handle(req('POST', `/projects/${projId}/estimates`, token, makePayload(projId)))
    expect(c.status).toBe(200)
    const rid = (c.body as { revisionId: string }).revisionId

    const f = await api.handle(req('POST', `/estimates/${rid}/finalize`, token))
    expect(f.status).toBe(403)
    // status still draft (finalize did not happen)
    const g = await api.handle(req('GET', `/estimates/${rid}`, token))
    expect((g.body as { status: string }).status).toBe('draft')
  })

  it('owner: authorized for full commercial workflow', async () => {
    const { projId, token } = await bootstrap('API_Auth_Owner', 'owner')
    const finalized = await createFinalizedEstimate(token, projId)
    expect(finalized.status).toBe('finalized')
  })

  it('no membership: all commercial mutations denied (403)', async () => {
    // Bootstrap as owner, then create a 2nd user with NO membership in the org
    const owner = await bootstrap('API_Auth_NoMemb_Owner', 'owner')
    const noMembUser = await repos.users.create({
      id: entityId(ID_PREFIX.user), email: 'nomemb@test', displayName: 'nomemb',
      status: 'active', createdAt: new Date().toISOString(),
    })
    await repos.users.createBinding({
      id: entityId(ID_PREFIX.authBinding), userId: noMembUser.id, provider: 'test', subject: noMembUser.id,
      createdAt: new Date().toISOString(), lastUsedAt: null,
    })
    // The session resolver will try to resolve a membership in owner.orgId, but none exists
    const noMembToken = `tok_${noMembUser.id}::${owner.orgId}`

    const c = await api.handle(req('POST', `/projects/${owner.projId}/estimates`, noMembToken, makePayload(owner.projId)))
    expect(c.status).toBe(403)
  })
})

// ════════════════════════════════════════════════════════════════════════
// §7 Error mapping + security
// ════════════════════════════════════════════════════════════════════════

describe('API Error mapping + Security', () => {
  it('missing/invalid Authorization header → 401', async () => {
    const { projId } = await bootstrap('API_Err_Unauth')
    const r = await api.handle({ method: 'GET', path: `/projects/${projId}/estimates`, headers: {}, body: null })
    expect(r.status).toBe(401)
    expect((r.body as { error: string }).error).toBe('unauthenticated')
  })

  it('invalid token → 401', async () => {
    const r = await api.handle({ method: 'GET', path: '/projects/x/estimates', headers: { authorization: 'Bearer invalid' }, body: null })
    expect(r.status).toBe(401)
  })

  it('unknown route → 404', async () => {
    const { token } = await bootstrap('API_Err_404')
    const r = await api.handle(req('GET', '/nonexistent', token))
    expect(r.status).toBe(404)
  })

  it('malformed JSON body → 400 ValidationError (not 500)', async () => {
    const { projId, token } = await bootstrap('API_Err_Malformed')
    // body is a string, not an object
    const r = await api.handle(req('POST', `/projects/${projId}/estimates`, token, 'not-an-object'))
    expect(r.status).toBe(400)
    expect((r.body as { error: string }).error).toBe('validation')
  })

  it('missing required field → 400', async () => {
    const { projId, token } = await bootstrap('API_Err_Missing')
    const r = await api.handle(req('POST', `/projects/${projId}/estimates`, token, { projectId: projId }))
    expect(r.status).toBe(400)
  })

  it('invalid enum value → 400', async () => {
    const { projId, token } = await bootstrap('API_Err_Enum')
    const r = await api.handle(req('POST', `/projects/${projId}/measurements`, token, {
      sourceArtifactId: 'a', sourceArtifactHash: 'h', sheetId: null, sheetRevision: null,
      elementReference: 'e', quantityValue: 1, quantityUnit: 'm2',
      measurementMethod: 'INVALID', measurementBasis: 'count', measurementEngineVersion: 'v1',
    }))
    expect(r.status).toBe(400)
  })

  it('estimate payload projectId mismatch → 400 ValidationError', async () => {
    const { projId, token } = await bootstrap('API_Err_PayloadMismatch')
    const wrongPayload = makePayload('proj_other')
    const r = await api.handle(req('POST', `/projects/${projId}/estimates`, token, wrongPayload))
    expect(r.status).toBe(400)
  })

  it('SQL injection attempt in field value → handled safely (parameterized)', async () => {
    const { projId, token } = await bootstrap('API_Err_SQLi')
    // The repository uses parameterized queries; the injection string is treated as a literal.
    const r = await api.handle(req('POST', `/projects/${projId}/boqs`, token, {
      name: "'; DROP TABLE boqs; --",
    }))
    expect(r.status).toBe(200)
    // The boqs table still exists (not dropped)
    const list = await api.handle(req('GET', `/projects/${projId}/boqs`, token))
    expect(list.status).toBe(200)
  })

  it('oversized quantity is accepted (no silent truncation) but bounded by domain', async () => {
    const { projId, token } = await bootstrap('API_Err_Huge')
    const r = await api.handle(req('POST', `/projects/${projId}/boqs`, token, { name: 'B' }))
    const boqId = (r.body as { boqId: string }).boqId
    const item = await api.handle(req('POST', `/boqs/${boqId}/items`, token, {
      itemCode: '1', description: 'D', unit: 'm2',
      quantityValue: 1e15, quantityUnit: 'm2', provenance: 'manual',
    }))
    expect(item.status).toBe(200)
    expect((item.body as { quantity: { value: number } }).quantity.value).toBe(1e15)
  })

  it('error response does not leak SQL, stack traces, or schema', async () => {
    const { projId, token } = await bootstrap('API_Err_NoLeak')
    const r = await api.handle(req('POST', `/projects/${projId}/estimates`, token, 'bad'))
    const body = JSON.stringify(r.body)
    expect(body).not.toMatch(/SELECT|INSERT|UPDATE.*FROM|pg_|stack|at \/home|node_modules/i)
  })
})

// ════════════════════════════════════════════════════════════════════════
// §8 Audit atomicity through the API (forced audit failure rolls back)
// ════════════════════════════════════════════════════════════════════════

describe('API Audit atomicity', () => {
  it('forced audit failure via API → business mutation rolled back, 500 returned', async () => {
    const { orgId, projId, token } = await bootstrap('API_AuditFail')
    // Create a draft estimate first (its own audit succeeded)
    const r = await api.handle(req('POST', `/projects/${projId}/estimates`, token, makePayload(projId)))
    const rid = (r.body as { revisionId: string }).revisionId

    // Install a trigger that blocks audit INSERT
    await db.execRaw(`
      CREATE OR REPLACE FUNCTION block_audit_insert_api() RETURNS TRIGGER AS $$
      BEGIN RAISE EXCEPTION 'Test: audit insert blocked (API)'; END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS trg_block_audit_insert_api ON audit_events;
      CREATE TRIGGER trg_block_audit_insert_api BEFORE INSERT ON audit_events
        FOR EACH ROW EXECUTE FUNCTION block_audit_insert_api();
    `)
    try {
      // finalize → business mutation + audit in ONE tx → audit fails → whole tx rolls back
      const f = await api.handle(req('POST', `/estimates/${rid}/finalize`, token))
      // The audit failure is a non-DomainError → 500 (internal_error); the transaction rolled back.
      expect(f.status).toBe(500)
    } finally {
      await db.execRaw(`DROP TRIGGER IF EXISTS trg_block_audit_insert_api ON audit_events;`)
      await db.execRaw(`DROP FUNCTION IF EXISTS block_audit_insert_api();`)
    }

    // Business mutation rolled back: status still draft (NOT finalized)
    const after = await api.handle(req('GET', `/estimates/${rid}`, token))
    expect((after.body as { status: string }).status).toBe('draft')
    // No finalize audit persisted
    const ev = await repos.audit.listForEntity(orgId, 'revision', rid, 50)
    expect(ev.filter((e) => e.action === 'estimate.finalized')).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// §9 Cross-project (same tenant) validation
// ════════════════════════════════════════════════════════════════════════

describe('API Cross-project (same tenant)', () => {
  it('Bid for Project A cannot reference Project B EstimateRevision → 400', async () => {
    const a = await bootstrap('API_XProj_A')
    // Create a 2nd project in the SAME tenant
    const projB = await repos.projects.create({
      id: entityId(ID_PREFIX.project), tenantId: a.orgId, workspaceId: a.wsId,
      name: 'ProjectB', status: 'active', createdAt: new Date().toISOString(),
    })
    // Finalize an estimate in Project B
    const finalizedB = await createFinalizedEstimate(a.token, projB.id)
    // Try to create a bid in Project A referencing Project B's revision → 400
    const r = await api.handle(req('POST', `/projects/${a.projId}/bids`, a.token, {
      estimateRevisionId: finalizedB.revisionId,
      finalPrice: { amount: 70000, currency: 'GHS' },
    }))
    expect(r.status).toBe(400)
  })
})

// ════════════════════════════════════════════════════════════════════════
// §10 E2E Commercial workflow through the API
// ════════════════════════════════════════════════════════════════════════

describe('E2E Commercial workflow via API', () => {
  it('Estimate: create → update → finalize → replay (full HTTP round-trip)', async () => {
    const { projId, token } = await bootstrap('E2E_Estimate')
    // create
    const c = await api.handle(req('POST', `/projects/${projId}/estimates`, token, makePayload(projId, 500, 100)))
    const rid = (c.body as { revisionId: string }).revisionId
    // update (different rate + qty)
    await api.handle(req('PATCH', `/estimates/${rid}`, token, makePayload(projId, 600, 200)))
    // finalize
    const f = await api.handle(req('POST', `/estimates/${rid}/finalize`, token))
    expect((f.body as { status: string }).status).toBe('finalized')
    // replay — derived totals returned by the service, NOT computed by the API
    const r = await api.handle(req('GET', `/estimates/${rid}/replay`, token))
    expect(r.status).toBe(200)
    const replay = r.body as { contentHashMatches: boolean; totals: { totalLineCost: { amount: number } } }
    expect(replay.contentHashMatches).toBe(true)
    // 600 × 200 = 120000 minor
    expect(replay.totals.totalLineCost.amount).toBe(120000)
  })

  it('Bid: create → submit → outcome (full HTTP round-trip with timestamps)', async () => {
    const { projId, token } = await bootstrap('E2E_Bid')
    const finalized = await createFinalizedEstimate(token, projId)
    // create bid
    const c = await api.handle(req('POST', `/projects/${projId}/bids`, token, {
      estimateRevisionId: finalized.revisionId,
      finalPrice: { amount: 70000, currency: 'GHS' },
    }))
    const bidId = (c.body as { bidId: string }).bidId
    // submit
    const s = await api.handle(req('POST', `/bids/${bidId}/submit`, token))
    expect((s.body as { status: string; submittedAt: string | null }).submittedAt).not.toBeNull()
    // outcome
    const o = await api.handle(req('POST', `/bids/${bidId}/outcome`, token, { outcome: 'won', note: 'Won' }))
    const won = o.body as { status: string; outcomeAt: string | null; outcomeNote: string | null }
    expect(won.status).toBe('won')
    expect(won.outcomeAt).not.toBeNull()
    expect(won.outcomeNote).toBe('Won')
  })
})
