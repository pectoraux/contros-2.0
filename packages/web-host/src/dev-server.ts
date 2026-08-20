/**
 * Dev server entry — starts the Contractor GenOffice web host.
 *
 * Wires: PGlite (dev DB) → migrations → repositories → services → CoreApi →
 * WebSessionResolver → HTTP host.
 *
 * DEV-only auth requires CONTRACTOR_DEV_AUTH=1, CG_SESSION_SECRET, and
 * CG_DEV_CREDENTIAL in the environment. A dev user (CG_DEV_USER_EMAIL) must
 * already exist in the DB — run the seed script first.
 *
 * In dev: Vite serves the browser bundle on :5178; this host serves /api/*
 * on :5179. In production (not this phase): this host also serves the built
 * bundle from apps/web/dist.
 */

import { PGlite } from '@electric-sql/pglite'
import {
  PgLiteClient, FOUNDATION_MIGRATION_SQL, COMMERCIAL_MIGRATION_SQL, applyMigration,
  OrganizationRepository, UserRepository, MembershipRepository, WorkspaceRepository,
  ProjectRepository, AuditRepository, RevisionRepository,
  PlanMeasurementRepository, BOQRepository, EstimateRevisionRepository, BidRepository,
} from '@contractor/core/persistence'
import type { DbClient } from '@contractor/core/persistence'
import {
  IdentityService, OrganizationService, WorkspaceService, ProjectService,
  AuditService, RevisionService, PlanMeasurementService, BOQService, EstimateService, BidService,
} from '@contractor/core/service'
import { CoreApi } from '@contractor/core/api'
import {
  loadSessionConfigFromEnv, WebSessionResolver, startWebHost,
} from './index.js'
import { entityId, ID_PREFIX } from '@contractor/core/domain'

async function main() {
  const config = loadSessionConfigFromEnv()
  const port = Number(process.env.CG_WEB_PORT ?? 5179)
  const devUserEmail = process.env.CG_DEV_USER_EMAIL
  if (config.devAuthEnabled && !devUserEmail) {
    console.error('CG_DEV_USER_EMAIL is required when CONTRACTOR_DEV_AUTH=1')
    process.exit(1)
  }

  // Use PostgresClient when DATABASE_URL is a real Postgres URL; else PGlite (dev).
  let db: PgLiteClient | import('@contractor/core/persistence').PostgresClient
  if (process.env.DATABASE_URL && /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
    const { Pool } = await import('pg')
    const { PostgresClient } = await import('@contractor/core/persistence')
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5, ssl: { rejectUnauthorized: false },
    })
    db = new PostgresClient(pool)
    console.log('Using PostgreSQL:', process.env.DATABASE_URL.split('@')[1]?.split('/')[0] ?? '?')
  } else {
    const pg = new PGlite()
    db = new PgLiteClient(pg)
    console.log('Using PGlite (in-memory)')
  }
  await applyMigration(db, FOUNDATION_MIGRATION_SQL)
  await applyMigration(db, COMMERCIAL_MIGRATION_SQL)
  // Also apply magic-links + auth migrations (additive, idempotent)
  const { MAGIC_LINKS_MIGRATION_SQL, AUTH_MIGRATION_SQL } = await import('@contractor/core/persistence')
  await applyMigration(db, MAGIC_LINKS_MIGRATION_SQL)
  await applyMigration(db, AUTH_MIGRATION_SQL)

  // Seed a dev org/user/membership if none exists (idempotent)
  if (devUserEmail) {
    await seedDevUser(db, devUserEmail)
  }

  const users = new UserRepository(db)
  const memberships = new MembershipRepository(db)
  const organizations = new OrganizationRepository(db)
  const workspaces = new WorkspaceRepository(db)
  const projects = new ProjectRepository(db)
  const audit = new AuditRepository(db)
  const revisions = new RevisionRepository(db)
  const pm = new PlanMeasurementRepository(db)
  const boq = new BOQRepository(db)
  const estRev = new EstimateRevisionRepository(db)
  const bids = new BidRepository(db)

  const identity = new IdentityService(users, memberships)
  const orgService = new OrganizationService(organizations, memberships, audit)
  const wsService = new WorkspaceService(workspaces, audit)
  const projService = new ProjectService(projects, workspaces, audit)
  const auditService = new AuditService(audit)
  const revService = new RevisionService(revisions, projects, audit)
  const measurements = new PlanMeasurementService(db, pm, projects, audit)
  const boqs = new BOQService(db, boq, projects, audit)
  const estimates = new EstimateService(db, estRev, projects, audit)
  const bidService = new BidService(db, bids, estRev, audit)

  const coreApi = new CoreApi(
    { identity, organizations: orgService, workspaces: wsService, projects: projService,
      audit: auditService, revisions: revService, measurements, boqs, estimates, bids: bidService },
    new WebSessionResolver({ users, memberships, config }),
  )

  // Use the Vercel handler directly — it has all routes (password-login, signup,
  // demo-login, waitlist, etc.) and delegates to CoreApi. This ensures the dev
  // server and production Vercel function use exactly the same code path.
  // The Vercel handler is a standard (req, res) => void that works with http.createServer.
  const { createServer } = await import('node:http')
  const vercelHandler = (await import('./vercel-handler.js')).default
  const server = createServer(vercelHandler)
  server.listen(port)
  console.log(`Contractor GenOffice web host listening on http://localhost:${port}`)
  console.log(`  dev auth: ${config.devAuthEnabled ? 'ENABLED' : 'disabled'}`)

  // Graceful shutdown
  const shutdown = async () => {
    server.close()
    await db.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

/**
 * Seed a dev org + user + membership if they don't already exist.
 * Idempotent — safe to run on every start. Uses repository methods only (no raw SQL).
 */
async function seedDevUser(db: DbClient, email: string): Promise<void> {
  const { UserRepository, MembershipRepository, OrganizationRepository, WorkspaceRepository } = await import('@contractor/core/persistence')
  const users = new UserRepository(db)
  const memberships = new MembershipRepository(db)
  const orgs = new OrganizationRepository(db)
  const workspaces = new WorkspaceRepository(db)

  // Check if the user already exists
  let user = await users.getByEmail(email)
  let userId: string
  if (user) {
    userId = user.id
  } else {
    userId = entityId(ID_PREFIX.user)
    await users.create({
      id: userId, email, displayName: 'Dev User',
      status: 'active', createdAt: new Date().toISOString(),
    })
  }
  // Check if the user already has a membership
  const userMemberships = await memberships.listTenantsForUser(userId)
  if (userMemberships.length > 0) return
  // Seed a dev org + workspace + membership (owner role)
  const orgId = entityId(ID_PREFIX.organization)
  await orgs.create({
    id: orgId, tenantId: orgId, name: 'Dev Organization', slug: 'dev-org',
    status: 'active', createdAt: new Date().toISOString(),
  })
  await memberships.create({
    id: entityId(ID_PREFIX.membership), userId, organizationId: orgId,
    role: 'owner', status: 'active', createdAt: new Date().toISOString(),
  })
  await workspaces.create({
    id: entityId(ID_PREFIX.workspace), tenantId: orgId, organizationId: orgId,
    name: 'Default', createdAt: new Date().toISOString(),
  })
}

main().catch((e) => {
  console.error('Failed to start Contractor GenOffice web host:', e)
  process.exit(1)
})
