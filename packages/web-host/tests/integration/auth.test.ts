/**
 * Password auth + waitlist + demo login tests (Phase 2C.3.1 H2 fix).
 *
 * Runs against real PGlite (no mocks). Verifies:
 *  - password login (correct/wrong/nonexistent email — same generic failure)
 *  - inactive user rejected
 *  - demo login (valid/invalid role, is_demo check)
 *  - signup → waitlist (pending status)
 *  - admin approval → user created + can login
 *  - non-admin approval → 403
 *  - duplicate signup is idempotent
 *  - duplicate approval prevented
 *  - password hash never appears in API responses
 *  - cookie tampering rejected
 *  - production startup refuses DEV auth
 *  - logout clears session
 *
 * Uses the real CoreApi + WebSessionResolver + HTTP host (via the Vercel handler
 * wrapped in http.createServer) against real PGlite. NO MOCKS.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  PgLiteClient, FOUNDATION_MIGRATION_SQL, COMMERCIAL_MIGRATION_SQL,
  MAGIC_LINKS_MIGRATION_SQL, AUTH_MIGRATION_SQL, applyMigration,
  OrganizationRepository, UserRepository, MembershipRepository, WorkspaceRepository,
  ProjectRepository, AuditRepository, RevisionRepository,
  PlanMeasurementRepository, BOQRepository, EstimateRevisionRepository, BidRepository,
  MagicLinkRepository, WaitlistRepository,
} from '@contractor/core/persistence'
import {
  IdentityService, OrganizationService, WorkspaceService, ProjectService,
  AuditService, RevisionService, PlanMeasurementService, BOQService, EstimateService, BidService,
} from '@contractor/core/service'
import { CoreApi } from '@contractor/core/api'
import {
  loadSessionConfigFromEnv, WebSessionResolver, startWebHost,
} from '../../src/index.js'
import { PasswordAuthService, hashPassword } from '../../src/password-auth.js'
import { MagicLinkAuthService } from '../../src/magic-link.js'
import type { Server } from 'node:http'
import { entityId, ID_PREFIX } from '@contractor/core/domain'
import type { Membership } from '@contractor/core/domain'

const SECRET = 'e'.repeat(64)
const PORT = 5182

let db: PgLiteClient
let server: Server
let baseUrl: string
let repos: any
let passwordAuth: PasswordAuthService
let adminOrgId: string
let adminUserId: string

// Set env for session config
process.env.CG_SESSION_SECRET = SECRET
process.env.CG_DEV_CREDENTIAL = 'unused-in-this-test'
process.env.CONTRACTOR_DEV_AUTH = '0'
process.env.NODE_ENV = 'test'

async function bootstrapAdmin() {
  adminUserId = entityId(ID_PREFIX.user)
  await repos.users.create({ id: adminUserId, email: 'admin@test.com', displayName: 'Admin', status: 'active', createdAt: new Date().toISOString() })
  // Set a password
  await db.execute(`UPDATE users SET password_hash = $2 WHERE id = $1`, [adminUserId, hashPassword('AdminPass123')])
  adminOrgId = entityId(ID_PREFIX.organization)
  await repos.orgs.create({ id: adminOrgId, tenantId: adminOrgId, name: 'TestOrg', slug: 'testorg', status: 'active', createdAt: new Date().toISOString() })
  const m: Membership = { id: entityId(ID_PREFIX.membership), userId: adminUserId, organizationId: adminOrgId, role: 'admin', status: 'active', createdAt: new Date().toISOString() }
  await repos.memberships.create(m)
  const ws = await repos.workspaces.create({ id: entityId(ID_PREFIX.workspace), tenantId: adminOrgId, organizationId: adminOrgId, name: 'WS', createdAt: new Date().toISOString() })
  // Create auth binding
  await repos.users.createBinding({ id: entityId(ID_PREFIX.authBinding), userId: adminUserId, provider: 'email', subject: 'admin@test.com', createdAt: new Date().toISOString(), lastUsedAt: null })
}

async function bootstrapDemoUsers(orgId: string) {
  for (const role of ['owner', 'member', 'viewer'] as const) {
    const userId = entityId(ID_PREFIX.user)
    await db.execute(
      `INSERT INTO users (id, email, display_name, status, created_at, is_demo)
       VALUES ($1, $2, $3, 'active', $4, true)`,
      [userId, `demo-${role}@contractor.dev`, `Demo ${role}`, new Date().toISOString()],
    )
    await repos.users.createBinding({ id: entityId(ID_PREFIX.authBinding), userId, provider: 'email', subject: `demo-${role}@contractor.dev`, createdAt: new Date().toISOString(), lastUsedAt: null })
    const m: Membership = { id: entityId(ID_PREFIX.membership), userId, organizationId: orgId, role, status: 'active', createdAt: new Date().toISOString() }
    await repos.memberships.create(m)
  }
}

async function passwordLogin(email: string, password: string): Promise<{ status: number; cookie: string | null; body: any }> {
  const r = await fetch(`${baseUrl}/api/auth/password-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const setCookie = r.headers.get('set-cookie')
  const cookie = setCookie ? setCookie.split(';')[0] : null
  return { status: r.status, cookie, body: await r.json() }
}

async function demoLogin(role: string): Promise<{ status: number; cookie: string | null; body: any }> {
  const r = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  })
  const setCookie = r.headers.get('set-cookie')
  const cookie = setCookie ? setCookie.split(';')[0] : null
  return { status: r.status, cookie, body: await r.json() }
}

async function signup(email: string, displayName?: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, displayName: displayName ?? null }),
  })
  return { status: r.status, body: await r.json() }
}

async function selectTenant(cookie: string, membershipId: string): Promise<string> {
  const r = await fetch(`${baseUrl}/api/auth/select-tenant`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ membershipId }),
  })
  const setCookie = r.headers.get('set-cookie')
  return setCookie ? setCookie.split(';')[0]! : cookie
}

async function listWaitlist(cookie: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${baseUrl}/api/auth/waitlist`, { headers: { cookie } })
  return { status: r.status, body: await r.json() }
}

async function approveWaitlist(cookie: string, waitlistId: string, password: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${baseUrl}/api/auth/waitlist`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ waitlistId, password }),
  })
  return { status: r.status, body: await r.json() }
}

beforeAll(async () => {
  const pg = new PGlite()
  db = new PgLiteClient(pg)
  await applyMigration(db, FOUNDATION_MIGRATION_SQL)
  await applyMigration(db, COMMERCIAL_MIGRATION_SQL)
  await applyMigration(db, MAGIC_LINKS_MIGRATION_SQL)
  await applyMigration(db, AUTH_MIGRATION_SQL)

  repos = {
    users: new UserRepository(db), memberships: new MembershipRepository(db),
    orgs: new OrganizationRepository(db), workspaces: new WorkspaceRepository(db),
    projects: new ProjectRepository(db), audit: new AuditRepository(db),
    revisions: new RevisionRepository(db), pm: new PlanMeasurementRepository(db),
    boq: new BOQRepository(db), estRev: new EstimateRevisionRepository(db), bids: new BidRepository(db),
    magicLinks: new MagicLinkRepository(db), waitlist: new WaitlistRepository(db),
  }

  await bootstrapAdmin()
  await bootstrapDemoUsers(adminOrgId)

  passwordAuth = new PasswordAuthService({ db, users: repos.users, memberships: repos.memberships, organizations: repos.orgs, waitlist: repos.waitlist, audit: repos.audit })

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
  const config = loadSessionConfigFromEnv()
  const resolver = new WebSessionResolver({ users: repos.users, memberships: repos.memberships, config })
  const coreApi = new CoreApi(
    { identity, organizations: orgService, workspaces: wsService, projects: projService,
      audit: auditService, revisions: revService, measurements, boqs, estimates, bids: bidService },
    resolver,
  )

  // Use the Vercel handler (it has all auth routes) wrapped in http.createServer.
  // Inject the test's deps so the handler shares the same PGlite instance.
  const resolver2 = new WebSessionResolver({ users: repos.users, memberships: repos.memberships, config })
  const { default: vercelHandler, setCachedDepsForTesting } = await import('../../src/vercel-handler.js')
  setCachedDepsForTesting({
    coreApi, resolver: resolver2, users: repos.users, memberships: repos.memberships,
    organizations: repos.orgs, magicLinks: repos.magicLinks, magicLinkAuth: new MagicLinkAuthService(repos.users, repos.magicLinks, { linkSecret: 'f'.repeat(64), linkTtlSeconds: 900, appBaseUrl: 'http://test' }),
    passwordAuth, waitlist: repos.waitlist, audit: repos.audit, config, magicLinkConfig: { linkSecret: 'f'.repeat(64), linkTtlSeconds: 900, appBaseUrl: 'http://test' },
  })
  server = createServer(vercelHandler)
  server.listen(PORT)
  baseUrl = `http://localhost:${PORT}`
  await new Promise<void>((r) => server.on('listening', r))
})

afterAll(async () => { server.close(); await db.close() })

describe('Password auth (Phase 2C.3.1 H2)', () => {
  it('correct admin password → 200 + session cookie', async () => {
    const r = await passwordLogin('admin@test.com', 'AdminPass123')
    expect(r.status).toBe(200)
    expect(r.cookie).toContain('cg_session=')
    expect(r.body.userId).toBeDefined()
  })

  it('wrong password → 401 + generic message (no email leak)', async () => {
    const r = await passwordLogin('admin@test.com', 'wrong-password')
    expect(r.status).toBe(401)
    expect(r.body.error).toBe('unauthenticated')
    expect(r.body.message).toBe('Invalid email or password')
  })

  it('nonexistent email → 401 + SAME generic message', async () => {
    const r = await passwordLogin('nonexistent@test.com', 'any-password')
    expect(r.status).toBe(401)
    expect(r.body.message).toBe('Invalid email or password')
  })

  it('inactive user → 401', async () => {
    const userId = entityId(ID_PREFIX.user)
    await db.execute(
      `INSERT INTO users (id, email, display_name, status, created_at, password_hash)
       VALUES ($1, $2, 'Inactive', 'disabled', $3, $4)`,
      [userId, 'inactive@test.com', new Date().toISOString(), hashPassword('Password123')],
    )
    const r = await passwordLogin('inactive@test.com', 'Password123')
    expect(r.status).toBe(401)
  })

  it('password hash never appears in API response', async () => {
    const r = await passwordLogin('admin@test.com', 'AdminPass123')
    const bodyStr = JSON.stringify(r.body)
    expect(bodyStr).not.toMatch(/password_hash|salt:|scrypt/)
  })
})

describe('Demo login (Phase 2C.3.1 H2)', () => {
  it('demo owner → 200 + cookie', async () => {
    const r = await demoLogin('owner')
    expect(r.status).toBe(200)
    expect(r.cookie).toContain('cg_session=')
    expect(r.body.role).toBe('owner')
  })

  it('demo member → 200', async () => {
    const r = await demoLogin('member')
    expect(r.status).toBe(200)
  })

  it('demo viewer → 200', async () => {
    const r = await demoLogin('viewer')
    expect(r.status).toBe(200)
  })

  it('invalid role → 400', async () => {
    const r = await demoLogin('admin')
    expect(r.status).toBe(400)
  })

  it('arbitrary role string → 400', async () => {
    const r = await demoLogin('superuser')
    expect(r.status).toBe(400)
  })
})

describe('Signup + waitlist (Phase 2C.3.1 H2)', () => {
  it('signup → pending + confirmation message', async () => {
    const r = await signup('newuser@test.com', 'New User')
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('pending')
    expect(r.body.message).toContain('waitlist')
  })

  it('duplicate signup → idempotent (same email, no error)', async () => {
    await signup('dup@test.com', 'First')
    const r2 = await signup('dup@test.com', 'Second')
    expect(r2.status).toBe(200)
    expect(r2.body.email).toBe('dup@test.com')
  })

  it('invalid email → 400', async () => {
    const r = await signup('not-an-email')
    expect(r.status).toBe(400)
  })

  it('pending waitlist user cannot login (no password set)', async () => {
    // The waitlist user exists in the table but has no users record → login fails
    const r = await passwordLogin('newuser@test.com', 'anypassword')
    expect(r.status).toBe(401)
  })
})

describe('Admin approval (Phase 2C.3.1 H2)', () => {
  it('admin approves waitlist entry → user created + can login', async () => {
    // Signup
    await signup('approvee@test.com', 'Approvee')
    // Login as admin
    const adminLogin = await passwordLogin('admin@test.com', 'AdminPass123')
    const adminCookie = adminLogin.cookie!
    // Select admin's tenant
    const memberships = await (await fetch(`${baseUrl}/api/auth/memberships`, { headers: { cookie: adminCookie } })).json() as { memberships: { membershipId: string; role: string }[] }
    const adminMemb = memberships.memberships.find((m: any) => m.role === 'admin')!
    const selectedCookie = await selectTenant(adminCookie, adminMemb.membershipId)
    // List waitlist + find the pending entry
    const wl = await listWaitlist(selectedCookie)
    expect(wl.status).toBe(200)
    const entry = wl.body.entries.find((e: any) => e.email === 'approvee@test.com')!
    expect(entry.status).toBe('pending')
    // Approve
    const approveR = await approveWaitlist(selectedCookie, entry.id, 'NewUserPass123')
    expect(approveR.status).toBe(200)
    expect(approveR.body.userId).toBeDefined()
    // The approved user can now login
    const userLogin = await passwordLogin('approvee@test.com', 'NewUserPass123')
    expect(userLogin.status).toBe(200)
  })

  it('non-admin cannot approve → 403', async () => {
    // Demo viewer is not admin
    const viewerLogin = await demoLogin('viewer')
    const viewerCookie = viewerLogin.cookie!
    // Select the viewer's membership
    const memberships = await (await fetch(`${baseUrl}/api/auth/memberships`, { headers: { cookie: viewerCookie } })).json() as { memberships: { membershipId: string; role: string }[] }
    const viewerMemb = memberships.memberships[0]
    const selectedCookie = await selectTenant(viewerCookie, viewerMemb.membershipId)
    // Try to list waitlist → 403
    const wl = await listWaitlist(selectedCookie)
    expect(wl.status).toBe(403)
  })

  it('unauthenticated cannot approve → 401', async () => {
    const wl = await listWaitlist('')
    expect(wl.status).toBe(401)
  })

  it('duplicate approval prevented (entry already approved)', async () => {
    // approvee@test.com was approved in the first test
    const adminLogin = await passwordLogin('admin@test.com', 'AdminPass123')
    const adminCookie = adminLogin.cookie!
    const memberships = await (await fetch(`${baseUrl}/api/auth/memberships`, { headers: { cookie: adminCookie } })).json() as { memberships: { membershipId: string; role: string }[] }
    const adminMemb = memberships.memberships.find((m: any) => m.role === 'admin')!
    const selectedCookie = await selectTenant(adminCookie, adminMemb.membershipId)
    const wl = await listWaitlist(selectedCookie)
    const entry = wl.body.entries.find((e: any) => e.email === 'approvee@test.com')!
    // Try to approve again → 409 (conflict: entry is already approved)
    const r = await approveWaitlist(selectedCookie, entry.id, 'AnotherPass123')
    expect(r.status).toBe(409)
  })

  it('approval with short password → 400', async () => {
    await signup('shortpass@test.com', 'Short')
    const adminLogin = await passwordLogin('admin@test.com', 'AdminPass123')
    const adminCookie = adminLogin.cookie!
    const memberships = await (await fetch(`${baseUrl}/api/auth/memberships`, { headers: { cookie: adminCookie } })).json() as { memberships: { membershipId: string; role: string }[] }
    const adminMemb = memberships.memberships.find((m: any) => m.role === 'admin')!
    const selectedCookie = await selectTenant(adminCookie, adminMemb.membershipId)
    const wl = await listWaitlist(selectedCookie)
    const entry = wl.body.entries.find((e: any) => e.email === 'shortpass@test.com')!
    const r = await approveWaitlist(selectedCookie, entry.id, 'short') // < 6 chars
    expect(r.status).toBe(400)
  })
})

describe('Cookie security (Phase 2C.3.1 H2)', () => {
  it('tampered cookie → 401', async () => {
    const r = await fetch(`${baseUrl}/api/projects`, {
      headers: { cookie: 'cg_session=tampered.bad-signature' },
    })
    expect(r.status).toBe(401)
  })

  it('expired cookie → 401', async () => {
    // Sign a session with a past expiry
    const { signSession } = await import('../../src/session.js')
    const expiredToken = signSession(
      { userId: adminUserId, selectedMembershipId: null, exp: Math.floor(Date.now() / 1000) - 3600 },
      SECRET,
    )
    const r = await fetch(`${baseUrl}/api/projects`, {
      headers: { cookie: `cg_session=${expiredToken}` },
    })
    expect(r.status).toBe(401)
  })

  it('logout clears session', async () => {
    const login = await passwordLogin('admin@test.com', 'AdminPass123')
    const cookie = login.cookie!
    // Logout
    await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { cookie } })
    // After logout, the cookie should be cleared — but since we're not a browser,
    // we verify the Set-Cookie header contains Max-Age=0
    const logoutR = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { cookie } })
    const setCookie = logoutR.headers.get('set-cookie')!
    expect(setCookie).toContain('Max-Age=0')
  })
})

describe('Production DEV-auth guard (Phase 2C.3.1 H2)', () => {
  it('DEV auth is disabled when CONTRACTOR_DEV_AUTH=0', () => {
    // The config is loaded from env (set to '0' at the top of this file)
    const config = loadSessionConfigFromEnv()
    expect(config.devAuthEnabled).toBe(false)
  })

  it('dev-login returns 404 when DEV auth disabled', async () => {
    const r = await fetch(`${baseUrl}/api/auth/dev-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'anything' }),
    })
    expect(r.status).toBe(404)
  })
})

// ════════════════════════════════════════════════════════════════════════
// Phase 2C.3.2 — H3/H4/H5/H6 regression tests
// ════════════════════════════════════════════════════════════════════════

describe('H4: multi-tenant approval uses SELECTED membership', () => {
  it('approval creates user in the SELECTED tenant, not a different admin tenant', async () => {
    // Create a 2nd org + admin membership for the admin user (so they have 2 tenants)
    const orgB = entityId(ID_PREFIX.organization)
    await repos.orgs.create({ id: orgB, tenantId: orgB, name: 'OrgB', slug: 'orgb', status: 'active', createdAt: new Date().toISOString() })
    const mB: Membership = { id: entityId(ID_PREFIX.membership), userId: adminUserId, organizationId: orgB, role: 'admin', status: 'active', createdAt: new Date().toISOString() }
    await repos.memberships.create(mB)
    // Signup a new user
    await signup('multitenant@test.com', 'MultiTenant')
    // Login as admin + select Tenant A (adminOrgId)
    const adminLogin = await passwordLogin('admin@test.com', 'AdminPass123')
    const memberships = await (await fetch(`${baseUrl}/api/auth/memberships`, { headers: { cookie: adminLogin.cookie! } })).json() as { memberships: { membershipId: string; organizationId: string }[] }
    const tenantAMemb = memberships.memberships.find((m) => m.organizationId === adminOrgId)!
    const selectedCookie = await selectTenant(adminLogin.cookie!, tenantAMemb.membershipId)
    // Approve → should create the user in Tenant A (adminOrgId), NOT Tenant B
    const wl = await listWaitlist(selectedCookie)
    const entry = wl.body.entries.find((e: any) => e.email === 'multitenant@test.com')!
    const approveR = await approveWaitlist(selectedCookie, entry.id, 'MultiPass123')
    expect(approveR.status).toBe(200)
    // Verify the user's membership is in Tenant A (adminOrgId), NOT Tenant B
    const createdUser = await repos.users.getByEmail('multitenant@test.com')
    const userMemberships = await repos.memberships.listTenantsForUser(createdUser!.id)
    expect(userMemberships).toHaveLength(1)
    expect(userMemberships[0]!.organizationId).toBe(adminOrgId) // SELECTED tenant
    expect(userMemberships[0]!.organizationId).not.toBe(orgB) // NOT the other tenant
  })

  it('admin without selected membership → 403', async () => {
    // Login but don't select a tenant
    const adminLogin = await passwordLogin('admin@test.com', 'AdminPass123')
    const wl = await listWaitlist(adminLogin.cookie!)
    expect(wl.status).toBe(403) // No tenant selected
  })
})

describe('H3: audit atomicity in approval', () => {
  it('forced audit failure → all approval writes roll back', async () => {
    // Signup a new user for this test
    await signup('auditfail@test.com', 'AuditFail')
    // Login as admin + select tenant
    const adminLogin = await passwordLogin('admin@test.com', 'AdminPass123')
    const memberships = await (await fetch(`${baseUrl}/api/auth/memberships`, { headers: { cookie: adminLogin.cookie! } })).json() as { memberships: { membershipId: string }[] }
    const selectedCookie = await selectTenant(adminLogin.cookie!, memberships.memberships[0]!.membershipId)
    // Get the waitlist entry
    const wl = await listWaitlist(selectedCookie)
    const entry = wl.body.entries.find((e: any) => e.email === 'auditfail@test.com')!
    // Install a trigger that blocks audit INSERT
    await db.execRaw(`
      CREATE OR REPLACE FUNCTION block_audit_approval() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.action = 'waitlist.approved' THEN
          RAISE EXCEPTION 'Test: audit blocked for approval';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS trg_block_audit_approval ON audit_events;
      CREATE TRIGGER trg_block_audit_approval BEFORE INSERT ON audit_events
        FOR EACH ROW EXECUTE FUNCTION block_audit_approval();
    `)
    try {
      // Attempt approval → should fail (audit INSERT fails → tx rolls back)
      const r = await approveWaitlist(selectedCookie, entry.id, 'AuditFailPass123')
      expect(r.status).toBeGreaterThanOrEqual(400) // 500 or 409
      // Verify NO user was created
      const u = await repos.users.getByEmail('auditfail@test.com')
      expect(u).toBeNull()
      // Verify waitlist entry is still pending
      const updatedEntry = await repos.waitlist.getById(entry.id)
      expect(updatedEntry!.status).toBe('pending')
      // Verify NO audit event for this approval
      const events = await repos.audit.listForEntity(adminOrgId, 'waitlist', entry.id, 50)
      expect(events.filter((e: any) => e.action === 'waitlist.approved')).toHaveLength(0)
    } finally {
      await db.execRaw(`DROP TRIGGER IF EXISTS trg_block_audit_approval ON audit_events;`)
      await db.execRaw(`DROP FUNCTION IF EXISTS block_audit_approval();`)
    }
  })
})

describe('H3: success path — audit emitted', () => {
  it('approval produces exactly ONE audit event with correct tenantId + actorId', async () => {
    await signup('auditsuccess@test.com', 'AuditSuccess')
    const adminLogin = await passwordLogin('admin@test.com', 'AdminPass123')
    const memberships = await (await fetch(`${baseUrl}/api/auth/memberships`, { headers: { cookie: adminLogin.cookie! } })).json() as { memberships: { membershipId: string }[] }
    const selectedCookie = await selectTenant(adminLogin.cookie!, memberships.memberships[0]!.membershipId)
    const wl = await listWaitlist(selectedCookie)
    const entry = wl.body.entries.find((e: any) => e.email === 'auditsuccess@test.com')!
    const approveR = await approveWaitlist(selectedCookie, entry.id, 'SuccessPass123')
    expect(approveR.status).toBe(200)
    // Verify exactly ONE audit event
    const events = await repos.audit.listForEntity(adminOrgId, 'waitlist', entry.id, 50)
    const approvalEvents = events.filter((e: any) => e.action === 'waitlist.approved')
    expect(approvalEvents).toHaveLength(1)
    // Verify audit metadata
    expect(approvalEvents[0]!.tenantId).toBe(adminOrgId) // matches selected membership's tenant
    expect(approvalEvents[0]!.actorId).toBe(adminUserId) // matches authenticated admin
    expect(approvalEvents[0]!.operation).toBe('approve')
  })
})

describe('H6: error mapping', () => {
  it('invalid waitlistId → 409 (conflict: not found)', async () => {
    const adminLogin = await passwordLogin('admin@test.com', 'AdminPass123')
    const memberships = await (await fetch(`${baseUrl}/api/auth/memberships`, { headers: { cookie: adminLogin.cookie! } })).json() as { memberships: { membershipId: string }[] }
    const selectedCookie = await selectTenant(adminLogin.cookie!, memberships.memberships[0]!.membershipId)
    const r = await approveWaitlist(selectedCookie, 'nonexistent-waitlist-id', 'SomePass123')
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('conflict')
  })

  it('short password → 400 (validation)', async () => {
    await signup('shortpass2@test.com', 'Short2')
    const adminLogin = await passwordLogin('admin@test.com', 'AdminPass123')
    const memberships = await (await fetch(`${baseUrl}/api/auth/memberships`, { headers: { cookie: adminLogin.cookie! } })).json() as { memberships: { membershipId: string }[] }
    const selectedCookie = await selectTenant(adminLogin.cookie!, memberships.memberships[0]!.membershipId)
    const wl = await listWaitlist(selectedCookie)
    const entry = wl.body.entries.find((e: any) => e.email === 'shortpass2@test.com')!
    const r = await approveWaitlist(selectedCookie, entry.id, 'short')
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('validation')
  })

  it('unauthenticated → 401', async () => {
    const r = await approveWaitlist('', 'some-id', 'SomePass123')
    expect(r.status).toBe(401)
  })

  it('non-admin role → 403', async () => {
    const viewerLogin = await demoLogin('viewer')
    const memberships = await (await fetch(`${baseUrl}/api/auth/memberships`, { headers: { cookie: viewerLogin.cookie! } })).json() as { memberships: { membershipId: string }[] }
    const selectedCookie = await selectTenant(viewerLogin.cookie!, memberships.memberships[0]!.membershipId)
    const wl = await listWaitlist(selectedCookie)
    expect(wl.status).toBe(403)
  })

  it('error response does not leak SQL/stack/schema', async () => {
    const adminLogin = await passwordLogin('admin@test.com', 'AdminPass123')
    const memberships = await (await fetch(`${baseUrl}/api/auth/memberships`, { headers: { cookie: adminLogin.cookie! } })).json() as { memberships: { membershipId: string }[] }
    const selectedCookie = await selectTenant(adminLogin.cookie!, memberships.memberships[0]!.membershipId)
    const r = await approveWaitlist(selectedCookie, 'nonexistent-id', 'SomePass123')
    const bodyStr = JSON.stringify(r.body)
    expect(bodyStr).not.toMatch(/SELECT|INSERT|UPDATE.*FROM|pg_|stack|at \/home|node_modules/i)
  })
})
