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

  const pg = new PGlite()
  const db = new PgLiteClient(pg)
  await applyMigration(db, FOUNDATION_MIGRATION_SQL)
  await applyMigration(db, COMMERCIAL_MIGRATION_SQL)

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

  const server = startWebHost(
    {
      coreApi, resolver: new WebSessionResolver({ users, memberships, config }),
      users, memberships, organizations, config,
      staticDir: null, // dev: Vite serves the browser
      secure: false, // dev: not over HTTPS
    },
    port,
  )
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
 * Idempotent — safe to run on every start.
 */
async function seedDevUser(db: PgLiteClient, email: string): Promise<void> {
  // Check if the user already exists
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`, [email],
  )
  let userId: string
  if (existing.length > 0) {
    userId = existing[0]!.id
  } else {
    userId = entityId(ID_PREFIX.user)
    await db.execute(
      `INSERT INTO users (id, email, display_name, status, created_at)
       VALUES ($1, $2, $3, 'active', $4)`,
      [userId, email, 'Dev User', new Date().toISOString()],
    )
  }
  // Check if the user already has a membership
  const existingM = await db.query<{ id: string }>(
    `SELECT id FROM memberships WHERE user_id = $1 AND status = 'active'`, [userId],
  )
  if (existingM.length > 0) return
  // Seed a dev org + workspace + membership (owner role)
  const orgId = entityId(ID_PREFIX.organization)
  await db.execute(
    `INSERT INTO organizations (id, tenant_id, name, slug, status, created_at)
     VALUES ($1, $2, $3, $4, 'active', $5)`,
    [orgId, orgId, 'Dev Organization', 'dev-org', new Date().toISOString()],
  )
  await db.execute(
    `INSERT INTO memberships (id, user_id, organization_id, tenant_id, role, status, created_at)
     VALUES ($1, $2, $3, $4, 'owner', 'active', $5)`,
    [entityId(ID_PREFIX.membership), userId, orgId, orgId, new Date().toISOString()],
  )
  await db.execute(
    `INSERT INTO workspaces (id, tenant_id, organization_id, name, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [entityId(ID_PREFIX.workspace), orgId, orgId, 'Default', new Date().toISOString()],
  )
}

main().catch((e) => {
  console.error('Failed to start Contractor GenOffice web host:', e)
  process.exit(1)
})
