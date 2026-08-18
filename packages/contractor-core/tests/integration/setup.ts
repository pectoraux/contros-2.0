/**
 * Integration test setup — creates a REAL PostgreSQL instance via pglite
 * (PostgreSQL 16 compiled to WASM), applies the foundation migration,
 * and returns repos + services + a tenant-context factory.
 *
 * This is NOT a mock. pglite IS real PostgreSQL. Tests against it
 * exercise real PostgreSQL semantics (constraints, transactions, triggers,
 * tenant isolation, immutability). (Phase 1 section 22.)
 */

import { PGlite } from '@electric-sql/pglite'
import { PgLiteClient, FOUNDATION_MIGRATION_SQL, applyMigration } from '../../src/persistence/index.js'
import {
  OrganizationRepository,
  UserRepository,
  MembershipRepository,
  WorkspaceRepository,
  ProjectRepository,
  AuditRepository,
  RevisionRepository,
} from '../../src/persistence/index.js'
import {
  IdentityService,
  OrganizationService,
  WorkspaceService,
  ProjectService,
  AuditService,
  RevisionService,
} from '../../src/service/index.js'
import type { TenantContext, Membership, User, Organization } from '../../src/domain/types.js'
import { createTenantContext } from '../../src/domain/tenant-context.js'
import { entityId, ID_PREFIX } from '../../src/domain/ids.js'

export interface TestFixture {
  db: PgLiteClient
  repos: {
    orgs: OrganizationRepository
    users: UserRepository
    memberships: MembershipRepository
    workspaces: WorkspaceRepository
    projects: ProjectRepository
    audit: AuditRepository
    revisions: RevisionRepository
  }
  services: {
    identity: IdentityService
    organizations: OrganizationService
    workspaces: WorkspaceService
    projects: ProjectService
    audit: AuditService
    revisions: RevisionService
  }
  /** Create a tenant context for a user with a given role in a tenant. */
  ctxFor: (tenantId: string, userId: string, role?: Membership['role']) => TenantContext
  /** Bootstrap a full tenant: user + org + owner membership. Returns the entities + ctx. */
  bootstrapTenant: (orgName: string, slug: string, userEmail: string, role?: Membership['role']) => Promise<{
    user: User
    org: Organization
    membership: Membership
    ctx: TenantContext
  }>
  cleanup: () => Promise<void>
}

export async function createTestFixture(): Promise<TestFixture> {
  const pg = new PGlite()
  const db = new PgLiteClient(pg)
  await applyMigration(db, FOUNDATION_MIGRATION_SQL)

  const repos = {
    orgs: new OrganizationRepository(db),
    users: new UserRepository(db),
    memberships: new MembershipRepository(db),
    workspaces: new WorkspaceRepository(db),
    projects: new ProjectRepository(db),
    audit: new AuditRepository(db),
    revisions: new RevisionRepository(db),
  }

  const services = {
    identity: new IdentityService(repos.users, repos.memberships),
    organizations: new OrganizationService(repos.orgs, repos.memberships, repos.audit),
    workspaces: new WorkspaceService(repos.workspaces, repos.audit),
    projects: new ProjectService(repos.projects, repos.workspaces, repos.audit),
    audit: new AuditService(repos.audit),
    revisions: new RevisionService(repos.revisions, repos.projects, repos.audit),
  }

  const ctxFor = (tenantId: string, userId: string, role: Membership['role'] = 'member'): TenantContext => {
    const membership: Membership = {
      id: entityId(ID_PREFIX.membership),
      userId,
      organizationId: tenantId,
      role,
      status: 'active',
      createdAt: new Date().toISOString(),
    }
    return createTenantContext(tenantId, userId, membership)
  }

  const bootstrapTenant = async (
    orgName: string,
    slug: string,
    userEmail: string,
    role: Membership['role'] = 'owner',
  ) => {
    const user = await repos.users.create({
      id: entityId(ID_PREFIX.user),
      email: userEmail,
      displayName: orgName + ' user',
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    const orgId = entityId(ID_PREFIX.organization)
    const org = await repos.orgs.create({
      id: orgId,
      tenantId: orgId,
      name: orgName,
      slug,
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    const membership = await repos.memberships.create({
      id: entityId(ID_PREFIX.membership),
      userId: user.id,
      organizationId: orgId,
      role,
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    const ctx = createTenantContext(orgId, user.id, membership)
    return { user, org, membership, ctx }
  }

  const cleanup = async () => {
    await db.close()
  }

  return { db, repos, services, ctxFor, bootstrapTenant, cleanup }
}
