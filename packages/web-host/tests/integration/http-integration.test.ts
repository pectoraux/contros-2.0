/**
 * HTTP integration tests — real HTTP → Node host → CoreApi → service → repository → PGlite.
 *
 * NO MOCKS. The host is started on a real port with a real PGlite DB; tests
 * make real HTTP requests (fetch) and assert both HTTP responses AND direct
 * DB state (via the repositories).
 *
 * Verifies (Phase 2C.1 §19, §25):
 *  - DEV auth gate
 *  - dev-login (requires server-side credential)
 *  - multi-membership tenant selection (server validates membership)
 *  - unauthenticated → 401
 *  - tenant A cannot access tenant B (404, no leak)
 *  - viewer cannot mutate (403)
 *  - malformed → 400
 *  - SQL injection harmless (parameterized)
 *  - BOQ/estimate/bid mutations traverse the full stack
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import {
  PgLiteClient, FOUNDATION_MIGRATION_SQL, COMMERCIAL_MIGRATION_SQL, applyMigration,
  OrganizationRepository, UserRepository, MembershipRepository, WorkspaceRepository,
  ProjectRepository, AuditRepository, RevisionRepository,
  PlanMeasurementRepository, BOQRepository, EstimateRevisionRepository, BidRepository,
} from '@contractor/core/persistence'
import {
  IdentityService, OrganizationService, WorkspaceService, ProjectService,
  AuditService, RevisionService, PlanMeasurementService, BOQService, EstimateService, BidService,
} from '@contractor/core/service'
import { CoreApi } from '@contractor/core/api'
import {
  loadSessionConfigFromEnv, WebSessionResolver, startWebHost, type WebHostDeps,
} from '../../src/index.js'
import type { Server } from 'node:http'
import { entityId, ID_PREFIX } from '@contractor/core/domain'
import type { Membership } from '@contractor/core/domain'

const PORT = 5181
const SECRET = 'a'.repeat(64)
const DEV_CRED = 'test-dev-credential-12345'

let db: PgLiteClient
let server: Server
let baseUrl: string
let repos: any

process.env.CG_SESSION_SECRET = SECRET
process.env.CG_DEV_CREDENTIAL = DEV_CRED
process.env.CONTRACTOR_DEV_AUTH = '1'
process.env.NODE_ENV = 'test'
process.env.CG_DEV_USER_EMAIL = 'dev@test'

async function bootstrapTenant(name: string, role: 'owner' | 'admin' | 'member' | 'viewer' = 'owner') {
  const uniq = name + '_' + Math.random().toString(36).slice(2, 6)
  const userId = entityId(ID_PREFIX.user)
  await repos.users.create({ id: userId, email: uniq + '@test', displayName: uniq, status: 'active', createdAt: new Date().toISOString() })
  const orgId = entityId(ID_PREFIX.organization)
  await repos.orgs.create({ id: orgId, tenantId: orgId, name: uniq, slug: uniq, status: 'active', createdAt: new Date().toISOString() })
  const membership: Membership = { id: entityId(ID_PREFIX.membership), userId, organizationId: orgId, role, status: 'active', createdAt: new Date().toISOString() }
  await repos.memberships.create(membership)
  const ws = await repos.workspaces.create({ id: entityId(ID_PREFIX.workspace), tenantId: orgId, organizationId: orgId, name: 'WS', createdAt: new Date().toISOString() })
  const proj = await repos.projects.create({ id: entityId(ID_PREFIX.project), tenantId: orgId, workspaceId: ws.id, name: 'P', status: 'active', createdAt: new Date().toISOString() })
  return { userId, orgId, wsId: ws.id, projId: proj.id, membershipId: membership.id, membership }
}

/** Login as the dev user — returns a cookie with NO tenant selected yet. */
async function devLogin(): Promise<{ cookie: string }> {
  const r = await fetch(`${baseUrl}/api/auth/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: DEV_CRED }),
  })
  expect(r.status).toBe(200)
  const setCookie = r.headers.get('set-cookie')!
  return { cookie: setCookie.split(';')[0]! }
}

/** Select a specific membership (tenant) for the logged-in dev user. Returns the REISSUED cookie. */
async function selectMembership(cookie: string, membershipId: string): Promise<string> {
  const r = await fetch(`${baseUrl}/api/auth/select-tenant`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ membershipId }),
  })
  expect(r.status).toBe(200)
  // The select-tenant response reissues the cookie with selectedMembershipId set.
  const setCookie = r.headers.get('set-cookie')
  if (setCookie) {
    return setCookie.split(';')[0]!
  }
  return cookie // fallback (shouldn't happen)
}

/** Login as dev user and select a specific tenant. Returns the reissued cookie. */
async function devLoginIntoTenant(tenant: { orgId: string; membershipId: string }): Promise<string> {
  const { cookie } = await devLogin()
  return selectMembership(cookie, tenant.membershipId)
}

/** Add the dev user as a member of a tenant (so they can select it). */
async function addDevUserToTenant(orgId: string, role: 'owner' | 'admin' | 'member' | 'viewer'): Promise<string> {
  const devUser = await repos.users.getByEmail('dev@test')
  const membership: Membership = {
    id: entityId(ID_PREFIX.membership), userId: devUser!.id, organizationId: orgId, role,
    status: 'active', createdAt: new Date().toISOString(),
  }
  await repos.memberships.create(membership)
  return membership.id
}

beforeAll(async () => {
  const pg = new PGlite()
  db = new PgLiteClient(pg)
  await applyMigration(db, FOUNDATION_MIGRATION_SQL)
  await applyMigration(db, COMMERCIAL_MIGRATION_SQL)
  repos = {
    users: new UserRepository(db), memberships: new MembershipRepository(db),
    orgs: new OrganizationRepository(db), workspaces: new WorkspaceRepository(db),
    projects: new ProjectRepository(db), audit: new AuditRepository(db),
    revisions: new RevisionRepository(db), pm: new PlanMeasurementRepository(db),
    boq: new BOQRepository(db), estRev: new EstimateRevisionRepository(db), bids: new BidRepository(db),
  }
  await repos.users.create({ id: entityId(ID_PREFIX.user), email: 'dev@test', displayName: 'Dev User', status: 'active', createdAt: new Date().toISOString() })

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
  const coreApi = new CoreApi(
    { identity, organizations: orgService, workspaces: wsService, projects: projService,
      audit: auditService, revisions: revService, measurements, boqs, estimates, bids: bidService },
    new WebSessionResolver({ users: repos.users, memberships: repos.memberships, config: loadSessionConfigFromEnv() }),
  )
  const config = loadSessionConfigFromEnv()
  const deps: WebHostDeps = {
    coreApi, resolver: new WebSessionResolver({ users: repos.users, memberships: repos.memberships, config }),
    users: repos.users, memberships: repos.memberships, organizations: repos.orgs, config,
    staticDir: null, secure: false,
  }
  server = startWebHost(deps, PORT)
  baseUrl = `http://localhost:${PORT}`
  await new Promise<void>((r) => server.on('listening', r))
})

afterAll(async () => { server.close(); await db.close() })

describe('HTTP integration: auth', () => {
  it('GET /api/auth/dev-mode returns devAuth=true when enabled', async () => {
    const r = await fetch(`${baseUrl}/api/auth/dev-mode`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ devAuth: true })
  })

  it('POST /api/auth/dev-login without credential → 400', async () => {
    const r = await fetch(`${baseUrl}/api/auth/dev-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(r.status).toBe(400)
  })

  it('POST /api/auth/dev-login with wrong credential → 401', async () => {
    const r = await fetch(`${baseUrl}/api/auth/dev-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'wrong' }),
    })
    expect(r.status).toBe(401)
  })

  it('POST /api/auth/dev-login with correct credential → 200 + HttpOnly SameSite cookie', async () => {
    const r = await fetch(`${baseUrl}/api/auth/dev-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: DEV_CRED }),
    })
    expect(r.status).toBe(200)
    const sc = r.headers.get('set-cookie')!
    expect(sc).toContain('cg_session=')
    expect(sc).toContain('HttpOnly')
    expect(sc).toContain('SameSite=Strict')
  })

  it('unauthenticated request to /api/projects → 401', async () => {
    const r = await fetch(`${baseUrl}/api/projects`)
    expect(r.status).toBe(401)
  })

  it('forged cookie (bad signature) → 401', async () => {
    const r = await fetch(`${baseUrl}/api/projects`, { headers: { cookie: 'cg_session=forged.bad' } })
    expect(r.status).toBe(401)
  })

  it('authenticated but no tenant selected → 401 on commercial routes', async () => {
    const { cookie } = await devLogin()
    // No tenant selected yet
    const r = await fetch(`${baseUrl}/api/projects`, { headers: { cookie } })
    expect(r.status).toBe(401) // resolver returns null when no membership selected
  })

  it('forged membershipId (not belonging to user) → 403', async () => {
    const { cookie } = await devLogin()
    const r = await fetch(`${baseUrl}/api/auth/select-tenant`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ membershipId: 'membership_does_not_exist' }),
    })
    expect(r.status).toBe(403)
  })
})

describe('HTTP integration: tenant isolation', () => {
  it('Tenant A cannot GET Tenant B project → 404 (no leak)', async () => {
    const a = await bootstrapTenant('TenantA')
    const aMemb = await addDevUserToTenant(a.orgId, 'owner')
    const b = await bootstrapTenant('TenantB')
    // Dev user logs in + selects tenant A
    const cookie = await devLoginIntoTenant({ orgId: a.orgId, membershipId: aMemb })
    // Try to GET tenant B's project → 404 (existence not leaked)
    const r = await fetch(`${baseUrl}/api/projects/${b.projId}`, { headers: { cookie } })
    expect(r.status).toBe(404)
  })
})

describe('HTTP integration: authorization', () => {
  it('viewer cannot create project → 403', async () => {
    const v = await bootstrapTenant('AuthViewer', 'viewer')
    const vMemb = await addDevUserToTenant(v.orgId, 'viewer')
    const cookie = await devLoginIntoTenant({ orgId: v.orgId, membershipId: vMemb })
    const r = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ workspaceId: v.wsId, name: 'X' }),
    })
    expect(r.status).toBe(403)
  })

  it('owner can create project → 200', async () => {
    const t = await bootstrapTenant('AuthOwner', 'owner')
    const tMemb = await addDevUserToTenant(t.orgId, 'owner')
    const cookie = await devLoginIntoTenant({ orgId: t.orgId, membershipId: tMemb })
    const r = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ workspaceId: t.wsId, name: 'Owner Project' }),
    })
    expect(r.status).toBe(200)
  })
})

describe('HTTP integration: commercial mutations (full stack)', () => {
  it('create project + BOQ + estimate + finalize + bid + submit + audit', async () => {
    const t = await bootstrapTenant('FullStack')
    const tMemb = await addDevUserToTenant(t.orgId, 'owner')
    const cookie = await devLoginIntoTenant({ orgId: t.orgId, membershipId: tMemb })

    // Create project
    const pr = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ workspaceId: t.wsId, name: 'E2E Project' }),
    })
    expect(pr.status).toBe(200)
    const proj = await pr.json() as { id: string }

    // Create BOQ
    const br = await fetch(`${baseUrl}/api/projects/${proj.id}/boqs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: 'E2E BOQ' }),
    })
    expect(br.status).toBe(200)
    const boq = await br.json() as { boqId: string }

    // Add BOQ item
    const ir = await fetch(`${baseUrl}/api/boqs/${boq.boqId}/items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ itemCode: '1.1', description: 'Concrete', unit: 'm2', quantityValue: 100, quantityUnit: 'm2', provenance: 'manual' }),
    })
    expect(ir.status).toBe(200)

    // Create estimate draft
    const payload = {
      projectId: proj.id, currency: 'GHS',
      policy: { overheadPct: 0.10, contingencyPct: 0.05, targetProfitMode: 'markup', targetProfitRatio: 0.10 },
      lines: [{ lineId: 'l1', boqItemId: null, description: 'Concrete', quantityValue: 100, quantityUnit: 'm2', costBasis: 'unit-rate', rateMinor: 500, pricingStrategy: 'markup', pricingRatio: 0.20 }],
      note: null, pricingAlgorithmVersion: 'v1',
    }
    const er = await fetch(`${baseUrl}/api/projects/${proj.id}/estimates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(payload),
    })
    expect(er.status).toBe(200)
    const est = await er.json() as { revisionId: string }

    // Finalize estimate
    const fr = await fetch(`${baseUrl}/api/estimates/${est.revisionId}/finalize`, { method: 'POST', headers: { cookie } })
    expect(fr.status).toBe(200)
    expect((await fr.json() as { status: string }).status).toBe('finalized')

    // Replay (totals from server)
    const rr = await fetch(`${baseUrl}/api/estimates/${est.revisionId}/replay`, { headers: { cookie } })
    expect(rr.status).toBe(200)
    const replay = await rr.json() as { totals: { totalLineCost: { amount: number }; sellPrice: { amount: number } } }
    expect(replay.totals.totalLineCost.amount).toBe(50000)
    expect(replay.totals.sellPrice.amount).toBeGreaterThan(50000)

    // Create bid
    const br2 = await fetch(`${baseUrl}/api/projects/${proj.id}/bids`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ estimateRevisionId: est.revisionId, finalPrice: { amount: 70000, currency: 'GHS' } }),
    })
    expect(br2.status).toBe(200)
    const bid = await br2.json() as { bidId: string }

    // Submit bid
    const sr = await fetch(`${baseUrl}/api/bids/${bid.bidId}/submit`, { method: 'POST', headers: { cookie } })
    expect(sr.status).toBe(200)
    const submitted = await sr.json() as { status: string; submittedAt: string | null }
    expect(submitted.status).toBe('submitted')
    expect(submitted.submittedAt).not.toBeNull()

    // Verify audit emitted via the repository (full stack proof)
    const events = await repos.audit.listForEntity(t.orgId, 'bid', bid.bidId, 50)
    expect(events.filter((e: any) => e.action === 'bid.submitted')).toHaveLength(1)
  })
})

describe('HTTP integration: security', () => {
  it('malformed JSON body → 400 (not 500)', async () => {
    const t = await bootstrapTenant('Sec')
    const tMemb = await addDevUserToTenant(t.orgId, 'owner')
    const cookie = await devLoginIntoTenant({ orgId: t.orgId, membershipId: tMemb })
    const r = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: 'not-json',
    })
    expect(r.status).toBe(400)
    expect((await r.json() as { error: string }).error).toBe('validation')
  })

  it('SQL injection in field value → harmless (parameterized)', async () => {
    const t = await bootstrapTenant('SQLi')
    const tMemb = await addDevUserToTenant(t.orgId, 'owner')
    const cookie = await devLoginIntoTenant({ orgId: t.orgId, membershipId: tMemb })
    const r = await fetch(`${baseUrl}/api/projects/${t.projId}/boqs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: "'; DROP TABLE boqs; --" }),
    })
    expect(r.status).toBe(200)
    // The boqs table still exists
    const list = await fetch(`${baseUrl}/api/projects/${t.projId}/boqs`, { headers: { cookie } })
    expect(list.status).toBe(200)
  })

  it('error response does not leak SQL/stack/schema', async () => {
    const t = await bootstrapTenant('NoLeak')
    const tMemb = await addDevUserToTenant(t.orgId, 'owner')
    const cookie = await devLoginIntoTenant({ orgId: t.orgId, membershipId: tMemb })
    const r = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: 'not-json',
    })
    const body = JSON.stringify(await r.json())
    expect(body).not.toMatch(/SELECT|INSERT|UPDATE.*FROM|pg_|stack|at \/home|node_modules/i)
  })
})
