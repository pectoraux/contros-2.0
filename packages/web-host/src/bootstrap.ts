/**
 * Bootstrap script — runs migrations + seeds admin + demo users against the
 * production PostgreSQL (Neon). Run once after deploy (or after setting up
 * the DATABASE_URL env var).
 *
 * Usage:
 *   DATABASE_URL='postgresql://...' bun packages/web-host/src/bootstrap.ts
 *
 * The admin email/password come from env (REQUIRED — no hardcoded defaults):
 *   CG_ADMIN_EMAIL
 *   CG_ADMIN_PASSWORD (min 8 characters)
 */

import { Pool } from 'pg'
import {
  PostgresClient, FOUNDATION_MIGRATION_SQL, COMMERCIAL_MIGRATION_SQL,
  MAGIC_LINKS_MIGRATION_SQL, AUTH_MIGRATION_SQL, applyMigration,
  UserRepository, MembershipRepository, OrganizationRepository, WorkspaceRepository,
} from '@contractor/core/persistence'
import { entityId, ID_PREFIX } from '@contractor/core/domain'
import type { Membership } from '@contractor/core/domain'
import { hashPassword } from './password-auth.js'
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    console.error('DATABASE_URL must be a postgresql:// connection string')
    process.exit(1)
  }
  const adminEmail = process.env.CG_ADMIN_EMAIL
  const adminPassword = process.env.CG_ADMIN_PASSWORD
  if (!adminEmail || !adminPassword) {
    console.error('CG_ADMIN_EMAIL and CG_ADMIN_PASSWORD must be set in the environment. Refusing to use hardcoded credentials.')
    process.exit(1)
  }
  if (adminPassword.length < 8) {
    console.error('CG_ADMIN_PASSWORD must be at least 8 characters. Refusing to use a weak password.')
    process.exit(1)
  }

  console.log('Connecting to PostgreSQL...')
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  })
  const db = new PostgresClient(pool)

  console.log('Applying migrations...')
  await applyMigration(db, FOUNDATION_MIGRATION_SQL)
  await applyMigration(db, COMMERCIAL_MIGRATION_SQL)
  await applyMigration(db, MAGIC_LINKS_MIGRATION_SQL)
  await applyMigration(db, AUTH_MIGRATION_SQL)
  console.log('  ✓ migrations applied')

  const users = new UserRepository(db)
  const memberships = new MembershipRepository(db)
  const organizations = new OrganizationRepository(db)
  const workspaces = new WorkspaceRepository(db)

  // Bootstrap admin
  console.log(`Bootstrapping admin: ${adminEmail}`)
  let adminUserId: string
  const existingAdmin = await users.getByEmail(adminEmail.toLowerCase())
  if (existingAdmin) {
    adminUserId = existingAdmin.id
    // Update password via repository method
    await users.updatePasswordHash(adminUserId, hashPassword(adminPassword))
    // Ensure web auth binding exists (for session resolver) — idempotent
    const webBinding = await users.getBindingBySubject('web', adminUserId)
    if (!webBinding) {
      await users.createBinding({
        id: entityId(ID_PREFIX.authBinding), userId: adminUserId, provider: 'web', subject: adminUserId,
        createdAt: new Date().toISOString(), lastUsedAt: null,
      })
    }
    console.log('  ✓ admin password updated')
  } else {
    adminUserId = entityId(ID_PREFIX.user)
    await users.createWithPassword(
      { id: adminUserId, email: adminEmail.toLowerCase(), displayName: 'Admin', status: 'active', createdAt: new Date().toISOString() },
      hashPassword(adminPassword),
    )
    await users.createBinding({
      id: entityId(ID_PREFIX.authBinding), userId: adminUserId, provider: 'email', subject: adminEmail.toLowerCase(),
      createdAt: new Date().toISOString(), lastUsedAt: null,
    })
    // Also create a 'web' provider binding for the session resolver
    await users.createBinding({
      id: entityId(ID_PREFIX.authBinding), userId: adminUserId, provider: 'web', subject: adminUserId,
      createdAt: new Date().toISOString(), lastUsedAt: null,
    })
    console.log('  ✓ admin user created')
  }

  // Ensure admin has an org + membership
  let adminMemberships = await memberships.listTenantsForUser(adminUserId)
  let orgId: string
  if (adminMemberships.length > 0) {
    orgId = adminMemberships[0]!.organizationId
    console.log(`  ✓ admin already in org: ${orgId}`)
  } else {
    orgId = entityId(ID_PREFIX.organization)
    await organizations.create({
      id: orgId, tenantId: orgId, name: 'Contractor GenOffice', slug: 'contractor-genoffice',
      status: 'active', createdAt: new Date().toISOString(),
    })
    const m: Membership = {
      id: entityId(ID_PREFIX.membership), userId: adminUserId, organizationId: orgId,
      role: 'admin', status: 'active', createdAt: new Date().toISOString(),
    }
    await memberships.create(m)
    await workspaces.create({
      id: entityId(ID_PREFIX.workspace), tenantId: orgId, organizationId: orgId,
      name: 'Default', createdAt: new Date().toISOString(),
    })
    console.log(`  ✓ org + workspace + admin membership created: ${orgId}`)
  }

  // Bootstrap demo users
  console.log('Bootstrapping demo users...')
  for (const role of ['owner', 'member', 'viewer'] as const) {
    const email = `demo-${role}@contractor.dev`
    const existing = await users.getByEmail(email)
    if (existing) {
      // Ensure demo flag via repository method (no raw SQL in bootstrap — H5)
      await users.setDemoFlag(existing.id, true)
      // Ensure web auth binding exists (for session resolver)
      const webBinding = await users.getBindingBySubject('web', existing.id)
      if (!webBinding) {
        await users.createBinding({
          id: entityId(ID_PREFIX.authBinding), userId: existing.id, provider: 'web', subject: existing.id,
          createdAt: new Date().toISOString(), lastUsedAt: null,
        })
      }
      const demoMems = await memberships.listTenantsForUser(existing.id)
      if (demoMems.length === 0) {
        const m: Membership = {
          id: entityId(ID_PREFIX.membership), userId: existing.id, organizationId: orgId,
          role, status: 'active', createdAt: new Date().toISOString(),
        }
        await memberships.create(m)
      }
      console.log(`  ✓ demo-${role} exists (updated)`)
    } else {
      const demoUserId = entityId(ID_PREFIX.user)
      await users.createDemoUser(
        { id: demoUserId, email, displayName: `Demo ${role}`, status: 'active', createdAt: new Date().toISOString() },
      )
      await users.createBinding({
        id: entityId(ID_PREFIX.authBinding), userId: demoUserId, provider: 'email', subject: email,
        createdAt: new Date().toISOString(), lastUsedAt: null,
      })
      // Also create a 'web' provider binding so the session resolver can
      // resolve the user via IdentityService.resolveTenantContext('web', userId, tenantId).
      // The session cookie carries userId as the subject; the resolver passes
      // provider='web' to IdentityService.
      await users.createBinding({
        id: entityId(ID_PREFIX.authBinding), userId: demoUserId, provider: 'web', subject: demoUserId,
        createdAt: new Date().toISOString(), lastUsedAt: null,
      })
      const m: Membership = {
        id: entityId(ID_PREFIX.membership), userId: demoUserId, organizationId: orgId,
        role, status: 'active', createdAt: new Date().toISOString(),
      }
      await memberships.create(m)
      console.log(`  ✓ demo-${role} created`)
    }
  }

  console.log('\nBootstrap complete!')
  console.log(`  Admin login: ${adminEmail} / (password from env)`)
  console.log(`  Demo logins: Owner / Member / Viewer buttons on the login screen`)
  console.log(`  Org: ${orgId}`)

  await pool.end()
}

main().catch((e) => {
  console.error('Bootstrap failed:', e)
  process.exit(1)
})
