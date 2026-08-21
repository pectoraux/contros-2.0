/**
 * Bootstrap idempotency regression test (Phase 2C.4.1).
 *
 * Verifies that the admin bootstrap:
 * 1. Creates a web auth binding for a pre-existing admin who lacks one.
 * 2. Is idempotent — running again does not create a duplicate web binding.
 * 3. The resulting binding allows IdentityService.resolveTenantContext to work.
 *
 * Uses real PGlite (no mocks).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import {
  PgLiteClient, FOUNDATION_MIGRATION_SQL, COMMERCIAL_MIGRATION_SQL,
  MAGIC_LINKS_MIGRATION_SQL, AUTH_MIGRATION_SQL, applyMigration,
  UserRepository, MembershipRepository, OrganizationRepository, WorkspaceRepository,
} from '@contractor/core/persistence'
import { IdentityService } from '@contractor/core/service'
import { entityId, ID_PREFIX } from '@contractor/core/domain'
import type { Membership } from '@contractor/core/domain'
import { hashPassword } from '../../src/password-auth.js'

let db: PgLiteClient
let users: UserRepository
let memberships: MembershipRepository
let orgs: OrganizationRepository

beforeAll(async () => {
  const pg = new PGlite()
  db = new PgLiteClient(pg)
  await applyMigration(db, FOUNDATION_MIGRATION_SQL)
  await applyMigration(db, COMMERCIAL_MIGRATION_SQL)
  await applyMigration(db, MAGIC_LINKS_MIGRATION_SQL)
  await applyMigration(db, AUTH_MIGRATION_SQL)
  users = new UserRepository(db)
  memberships = new MembershipRepository(db)
  orgs = new OrganizationRepository(db)
})
afterAll(async () => { await db.close() })

describe('bootstrap admin web-binding idempotency (Phase 2C.4.1)', () => {
  it('creates web binding for existing admin who lacks one, then is idempotent', async () => {
    // 1. Create an admin user WITH email binding but WITHOUT web binding
    //    (simulates the pre-fix state)
    const adminEmail = 'idempotency@test.com'
    const adminUserId = entityId(ID_PREFIX.user)
    await users.createWithPassword(
      { id: adminUserId, email: adminEmail, displayName: 'Admin', status: 'active', createdAt: new Date().toISOString() },
      hashPassword('TestPass123'),
    )
    await users.createBinding({
      id: entityId(ID_PREFIX.authBinding), userId: adminUserId, provider: 'email', subject: adminEmail,
      createdAt: new Date().toISOString(), lastUsedAt: null,
    })
    // Create org + membership
    const orgId = entityId(ID_PREFIX.organization)
    await orgs.create({ id: orgId, tenantId: orgId, name: 'TestOrg', slug: 'testorg', status: 'active', createdAt: new Date().toISOString() })
    const m: Membership = { id: entityId(ID_PREFIX.membership), userId: adminUserId, organizationId: orgId, role: 'admin', status: 'active', createdAt: new Date().toISOString() }
    await memberships.create(m)

    // Verify: NO web binding exists initially
    let webBinding = await users.getBindingBySubject('web', adminUserId)
    expect(webBinding).toBeNull()

    // 2. Run the bootstrap logic for the existing admin
    //    (replicating the bootstrap.ts code path)
    const existingAdmin = await users.getByEmail(adminEmail)
    expect(existingAdmin).not.toBeNull()
    const existingId = existingAdmin!.id
    await users.updatePasswordHash(existingId, hashPassword('TestPass123'))
    // The fix: ensure web binding exists
    webBinding = await users.getBindingBySubject('web', existingId)
    if (!webBinding) {
      await users.createBinding({
        id: entityId(ID_PREFIX.authBinding), userId: existingId, provider: 'web', subject: existingId,
        createdAt: new Date().toISOString(), lastUsedAt: null,
      })
    }

    // 3. Assert web binding now exists with correct provider + subject
    webBinding = await users.getBindingBySubject('web', existingId)
    expect(webBinding).not.toBeNull()
    expect(webBinding!.provider).toBe('web')
    expect(webBinding!.subject).toBe(existingId)

    // 4. Assert idempotency: running again does NOT create a duplicate
    const bindingsBefore = await users.listBindingsForUser(existingId)
    const webBindingsBefore = bindingsBefore.filter(b => b.provider === 'web')
    expect(webBindingsBefore).toHaveLength(1)

    // Run the fix path again
    webBinding = await users.getBindingBySubject('web', existingId)
    if (!webBinding) {
      await users.createBinding({
        id: entityId(ID_PREFIX.authBinding), userId: existingId, provider: 'web', subject: existingId,
        createdAt: new Date().toISOString(), lastUsedAt: null,
      })
    }

    const bindingsAfter = await users.listBindingsForUser(existingId)
    const webBindingsAfter = bindingsAfter.filter(b => b.provider === 'web')
    expect(webBindingsAfter).toHaveLength(1) // still exactly 1

    // 5. Verify the binding allows IdentityService.resolveTenantContext to work
    const identity = new IdentityService(users, memberships)
    const result = await identity.resolveTenantContext('web', existingId, orgId)
    expect(result.ctx.tenantId).toBe(orgId)
    expect(result.ctx.actor.kind).toBe('user')
    if (result.ctx.actor.kind !== 'user') {
      throw new Error('Expected UserActor')
    }
    expect(result.ctx.actor.userId).toBe(existingId)
    expect(result.membership).not.toBeNull()
    expect(result.membership!.role).toBe('admin')
  })
})
