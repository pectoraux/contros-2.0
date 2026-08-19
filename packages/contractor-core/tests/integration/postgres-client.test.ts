/**
 * PostgresClient runtime verification (ADR-0009 D2).
 *
 * Runs the full repository + service suite against a REAL PostgreSQL when
 * `DATABASE_URL` is set. SKIPPED otherwise (PGlite remains the test substrate
 * for the rest of the suite). This closes the "NOT VERIFIED" gap from prior
 * phases for the standalone-Postgres path.
 *
 * The test verifies:
 *  - PostgresClient connects via DATABASE_URL + applies migrations
 *  - the connection-per-tx fix works (no cached connection; concurrent-safe)
 *  - a full commercial workflow (project → estimate → finalize → bid → submit)
 *    runs against real PostgreSQL with the same results as PGlite
 *  - transaction rollback works (audit-atomicity holds on real Postgres)
 *
 * Set DATABASE_URL to a real PostgreSQL connection string to run:
 *   DATABASE_URL='postgresql://user:pass@host/db' bun run vitest run tests/integration/postgres-client.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import {
  PostgresClient, FOUNDATION_MIGRATION_SQL, COMMERCIAL_MIGRATION_SQL, MAGIC_LINKS_MIGRATION_SQL,
  applyMigration, UserRepository, MembershipRepository, OrganizationRepository,
  WorkspaceRepository, ProjectRepository, AuditRepository, RevisionRepository,
  PlanMeasurementRepository, BOQRepository, EstimateRevisionRepository, BidRepository,
} from '@contractor/core/persistence'
import {
  IdentityService, OrganizationService, WorkspaceService, ProjectService,
  AuditService, RevisionService, PlanMeasurementService, BOQService, EstimateService, BidService,
} from '@contractor/core/service'
import { CoreApi } from '@contractor/core/api'
import { entityId, ID_PREFIX } from '@contractor/core/domain'
import type { Membership } from '@contractor/core/domain'

const DATABASE_URL = process.env.DATABASE_URL
// Only run if DATABASE_URL is a real Postgres connection string (postgres:// or postgresql://).
// This avoids false-activation on unrelated env DATABASE_URL values (e.g. a SQLite path).
const SKIP = !DATABASE_URL || !/^postgres(ql)?:\/\//.test(DATABASE_URL)

const describeOrSkip = SKIP ? describe.skip : describe

describeOrSkip('PostgresClient runtime (real PostgreSQL)', () => {
  let pool: Pool
  let db: PostgresClient
  let api: CoreApi
  let repos: any
  let orgId: string
  let membershipId: string

  beforeAll(async () => {
    if (SKIP) return
    pool = new Pool({ connectionString: DATABASE_URL!, max: 5 })
    db = new PostgresClient(pool)
    // Clean slate for the test (drop + recreate the schema objects)
    await db.execRaw(`
      DROP TABLE IF EXISTS magic_links, bid_outcomes, bids, estimate_revision_payloads,
        boq_items, boqs, plan_measurements, revision_counters, revisions, audit_events,
        projects, workspaces, memberships, organizations, auth_provider_bindings, users
      CASCADE;
    `)
    await applyMigration(db, FOUNDATION_MIGRATION_SQL)
    await applyMigration(db, COMMERCIAL_MIGRATION_SQL)
    await applyMigration(db, MAGIC_LINKS_MIGRATION_SQL)

    repos = {
      users: new UserRepository(db), memberships: new MembershipRepository(db),
      orgs: new OrganizationRepository(db), workspaces: new WorkspaceRepository(db),
      projects: new ProjectRepository(db), audit: new AuditRepository(db),
      revisions: new RevisionRepository(db), pm: new PlanMeasurementRepository(db),
      boq: new BOQRepository(db), estRev: new EstimateRevisionRepository(db), bids: new BidRepository(db),
    }
    // Bootstrap a tenant + user (owner)
    const userId = entityId(ID_PREFIX.user)
    await repos.users.create({ id: userId, email: 'pg@test', displayName: 'PG', status: 'active', createdAt: new Date().toISOString() })
    orgId = entityId(ID_PREFIX.organization)
    await repos.orgs.create({ id: orgId, tenantId: orgId, name: 'PGOrg', slug: 'pgorg', status: 'active', createdAt: new Date().toISOString() })
    const m: Membership = { id: entityId(ID_PREFIX.membership), userId, organizationId: orgId, role: 'owner', status: 'active', createdAt: new Date().toISOString() }
    await repos.memberships.create(m)
    membershipId = m.id
    const ws = await repos.workspaces.create({ id: entityId(ID_PREFIX.workspace), tenantId: orgId, organizationId: orgId, name: 'WS', createdAt: new Date().toISOString() })
    const proj = await repos.projects.create({ id: entityId(ID_PREFIX.project), tenantId: orgId, workspaceId: ws.id, name: 'P', status: 'active', createdAt: new Date().toISOString() })

    // Wire CoreApi with a synthetic resolver that resolves the bootstrapped tenant
    const identity = new IdentityService(repos.users, repos.memberships)
    const orgService = new OrganizationService(repos.orgs, repos.memberships, repos.audit)
    const wsService = new WorkspaceService(repos.workspaces, repos.audit)
    const projService = new ProjectService(repos.projects, repos.workspaces, repos.audit)
    const auditService = new AuditService(repos.audit)
    const revService = new RevisionService(repos.revisions, repos.projects, repos.audit)
    const measurements = new PlanMeasurementService(db, repos.pm, repos.projects, repos.audit)
    const boqs = new BOQService(db, repos.boq, repos.projects, repos.audit)
    const estimates = new EstimateService(db, repos.estRev, repos.projects, repos.audit)
    const bidService = new BidService(db, repos.bids, repos.estRev, repos.audit)
    api = new CoreApi(
      { identity, organizations: orgService, workspaces: wsService, projects: projService,
        audit: auditService, revisions: revService, measurements, boqs, estimates, bids: bidService },
      { async resolveSession() { return { provider: 'web', subject: userId, tenantId: orgId } } },
    )
  })

  afterAll(async () => { if (!SKIP) await pool.end() })

  it('PostgresClient executes queries + transactions against real PostgreSQL', async () => {
    // Simple query
    const rows = await db.query<{ x: number }>('SELECT 1 AS x')
    expect(rows[0]!.x).toBe(1)
    // Transaction (commit)
    const result = await db.tx(async (tx) => {
      const r = await tx.query<{ n: number }>('SELECT 42 AS n')
      return r[0]!.n
    })
    expect(result).toBe(42)
  })

  it('full commercial workflow against real PostgreSQL (project → estimate → finalize → bid → submit)', async () => {
    // Create project via CoreApi
    const projR = await api.handle({
      method: 'POST', path: '/projects',
      headers: { authorization: 'Bearer tok' },
      body: { workspaceId: (await repos.workspaces.listForTenant(orgId))[0]!.id, name: 'E2E PG' },
    })
    expect(projR.status).toBe(200)
    const projId = (projR.body as { id: string }).id

    // Create estimate
    const estR = await api.handle({
      method: 'POST', path: `/projects/${projId}/estimates`,
      headers: { authorization: 'Bearer tok' },
      body: {
        projectId: projId, currency: 'GHS',
        policy: { overheadPct: 0.10, contingencyPct: 0.05, targetProfitMode: 'markup', targetProfitRatio: 0.10 },
        lines: [{ lineId: 'l1', boqItemId: null, description: 'Concrete', quantityValue: 100, quantityUnit: 'm2', costBasis: 'unit-rate', rateMinor: 500, pricingStrategy: 'markup', pricingRatio: 0.20 }],
        note: null, pricingAlgorithmVersion: 'v1',
      },
    })
    expect(estR.status).toBe(200)
    const revId = (estR.body as { revisionId: string }).revisionId

    // Finalize
    const finR = await api.handle({ method: 'POST', path: `/estimates/${revId}/finalize`, headers: { authorization: 'Bearer tok' }, body: null })
    expect(finR.status).toBe(200)
    expect((finR.body as { status: string }).status).toBe('finalized')

    // Replay (verify totals — same as PGlite: 500 × 100 = 50000 minor)
    const replayR = await api.handle({ method: 'GET', path: `/estimates/${revId}/replay`, headers: { authorization: 'Bearer tok' }, body: null })
    expect(replayR.status).toBe(200)
    expect((replayR.body as { totals: { totalLineCost: { amount: number } } }).totals.totalLineCost.amount).toBe(50000)

    // Create + submit bid
    const bidR = await api.handle({
      method: 'POST', path: `/projects/${projId}/bids`,
      headers: { authorization: 'Bearer tok' },
      body: { estimateRevisionId: revId, finalPrice: { amount: 70000, currency: 'GHS' } },
    })
    expect(bidR.status).toBe(200)
    const bidId = (bidR.body as { bidId: string }).bidId
    const subR = await api.handle({ method: 'POST', path: `/bids/${bidId}/submit`, headers: { authorization: 'Bearer tok' }, body: null })
    expect(subR.status).toBe(200)
    expect((subR.body as { status: string; submittedAt: string | null }).status).toBe('submitted')
    expect((subR.body as { submittedAt: string | null }).submittedAt).not.toBeNull()

    // Verify audit emitted (full stack — real PostgreSQL)
    const events = await repos.audit.listForEntity(orgId, 'bid', bidId, 50)
    expect(events.filter((e: any) => e.action === 'bid.submitted')).toHaveLength(1)
  })

  it('transaction rollback works on real PostgreSQL (audit-atomicity holds)', async () => {
    // Force a failure mid-transaction and verify rollback
    await expect(
      db.tx(async (tx) => {
        await tx.execute(`INSERT INTO users (id, email, display_name, status, created_at) VALUES ($1, $2, $3, 'active', $4)`,
          [entityId(ID_PREFIX.user), 'rollback@test', 'RB', new Date().toISOString()])
        // Force a failure — duplicate key (insert the same user again)
        await tx.execute(`INSERT INTO users (id, email, display_name, status, created_at) VALUES ($1, $2, $3, 'active', $4)`,
          [entityId(ID_PREFIX.user), 'rollback@test', 'RB', new Date().toISOString()])
      }),
    ).rejects.toThrow()
    // The first insert should have rolled back — the user does not exist.
    const u = await repos.users.getByEmail('rollback@test')
    expect(u).toBeNull()
  })

  it('concurrent transactions on a shared PostgresClient do not corrupt each other', async () => {
    // Two concurrent transactions on the same module-global db instance.
    // The connection-per-tx fix means each gets its own connection from the pool.
    const [a, b] = await Promise.all([
      db.tx(async (tx) => { const r = await tx.query<{ v: number }>('SELECT 1 AS v'); return r[0]!.v }),
      db.tx(async (tx) => { const r = await tx.query<{ v: number }>('SELECT 2 AS v'); return r[0]!.v }),
    ])
    expect(a).toBe(1)
    expect(b).toBe(2)
  })
})
