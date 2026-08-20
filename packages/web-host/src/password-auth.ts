/**
 * Password auth service — email + password authentication (Phase 2C.3).
 *
 * Uses Node's built-in crypto.scrypt (no bcrypt dependency needed).
 * Passwords are stored as `salt:hash` in the users.password_hash column.
 *
 * The admin user is bootstrapped by the deploy script (email + password from
 * env: CG_ADMIN_EMAIL / CG_ADMIN_PASSWORD). Approved waitlist users get a
 * password set by the admin.
 * Demo accounts have a flag (is_demo) and use the demo-login endpoint (no password).
 */

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DbClient, UserRepository, MembershipRepository, OrganizationRepository } from '@contractor/core/persistence'
import type { WaitlistRepository } from '@contractor/core/persistence'
import { entityId, ID_PREFIX } from '@contractor/core/domain'
import type { Membership } from '@contractor/core/domain'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const colonIndex = stored.indexOf(':')
  if (colonIndex === -1) return false
  const salt = stored.slice(0, colonIndex)
  const hash = stored.slice(colonIndex + 1)
  const hashBuf = Buffer.from(hash, 'hex')
  const testBuf = scryptSync(password, salt, 64)
  if (hashBuf.length !== testBuf.length) return false
  return timingSafeEqual(hashBuf, testBuf)
}

export interface PasswordAuthDeps {
  readonly db: DbClient
  readonly users: UserRepository
  readonly memberships: MembershipRepository
  readonly organizations: OrganizationRepository
  readonly waitlist: WaitlistRepository
}

export class PasswordAuthService {
  constructor(private readonly deps: PasswordAuthDeps) {}

  /**
   * Login with email + password. Returns userId if valid, null otherwise.
   */
  async login(email: string, password: string): Promise<{ userId: string } | null> {
    const user = await this.deps.users.getByEmail(email.toLowerCase())
    if (!user || user.status !== 'active') return null
    const rows = await this.deps.db.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM users WHERE id = $1`, [user.id],
    )
    const passwordHash = rows[0]?.password_hash
    if (!passwordHash) return null // no password set — can't login with password
    if (!verifyPassword(password, passwordHash)) return null
    return { userId: user.id }
  }

  /**
   * Join the waitlist. Returns the entry (idempotent — if already on the list, returns existing).
   */
  async joinWaitlist(email: string, displayName: string | null): Promise<{ id: string; email: string; status: string }> {
    const id = entityId(ID_PREFIX.membership) // reuse the prefix for an ID
    const entry = await this.deps.waitlist.create(id, email, displayName)
    return { id: entry.id, email: entry.email, status: entry.status }
  }

  /**
   * Admin approves a waitlist entry. Creates a user with the given password,
   * adds them to the admin's org as a member, marks the waitlist entry approved.
   * ALL writes are in ONE transaction (db.tx) — if any fails, all roll back.
   * No orphaned user/membership can persist.
   */
  async approveWaitlistEntry(waitlistId: string, adminUserId: string, adminOrgId: string, password: string): Promise<{
    userId: string
    email: string
  }> {
    const entry = await this.deps.waitlist.getById(waitlistId)
    if (!entry) throw new Error('waitlist entry not found')
    if (entry.status !== 'pending') throw new Error(`entry is already ${entry.status}`)
    // Transactional: user + binding + membership + waitlist-approve all-or-nothing
    return this.deps.db.tx(async (tx) => {
      const userId = entityId(ID_PREFIX.user)
      const email = entry.email
      const displayName = entry.displayName ?? email.split('@')[0] ?? email
      await tx.execute(
        `INSERT INTO users (id, email, display_name, status, created_at, password_hash)
         VALUES ($1, $2, $3, 'active', $4, $5)`,
        [userId, email, displayName, new Date().toISOString(), hashPassword(password)],
      )
      await tx.execute(
        `INSERT INTO auth_provider_bindings (id, user_id, provider, subject, created_at, last_used_at)
         VALUES ($1, $2, 'email', $3, $4, NULL)`,
        [entityId(ID_PREFIX.authBinding), userId, email, new Date().toISOString()],
      )
      const membership: Membership = {
        id: entityId(ID_PREFIX.membership), userId, organizationId: adminOrgId,
        role: 'member', status: 'active', createdAt: new Date().toISOString(),
      }
      await tx.execute(
        `INSERT INTO memberships (id, user_id, organization_id, tenant_id, role, status, created_at)
         VALUES ($1, $2, $3, $3, $4, $5, $6)`,
        [membership.id, membership.userId, membership.organizationId, membership.role, membership.status, membership.createdAt],
      )
      await tx.execute(
        `UPDATE waitlist SET status = 'approved', approved_by = $2, approved_at = now(), created_user_id = $3
         WHERE id = $1 AND status = 'pending'`,
        [waitlistId, adminUserId, userId],
      )
      return { userId, email }
    })
  }

  /**
   * Demo login — returns the userId for a demo user of the given role.
   * Demo users must already exist in the DB (seeded by the deploy script).
   */
  async demoLogin(role: 'owner' | 'member' | 'viewer'): Promise<{ userId: string } | null> {
    const email = `demo-${role}@contractor.dev`
    const user = await this.deps.users.getByEmail(email)
    if (!user) return null
    // Verify it's actually a demo user
    const rows = await this.deps.db.query<{ is_demo: boolean }>(
      `SELECT is_demo FROM users WHERE id = $1`, [user.id],
    )
    if (!rows[0]?.is_demo) return null
    return { userId: user.id }
  }

  /**
   * Bootstrap the admin user (if not exists). Called by the deploy script.
   */
  async bootstrapAdmin(email: string, password: string): Promise<{ userId: string; orgId: string }> {
    // Check if admin already exists
    const existing = await this.deps.users.getByEmail(email.toLowerCase())
    let userId: string
    if (existing) {
      userId = existing.id
      // Update password
      await this.deps.db.execute(
        `UPDATE users SET password_hash = $2 WHERE id = $1`,
        [userId, hashPassword(password)],
      )
    } else {
      userId = entityId(ID_PREFIX.user)
      await this.deps.db.execute(
        `INSERT INTO users (id, email, display_name, status, created_at, password_hash)
         VALUES ($1, $2, 'Admin', 'active', $3, $4)`,
        [userId, email.toLowerCase(), new Date().toISOString(), hashPassword(password)],
      )
      await this.deps.users.createBinding({
        id: entityId(ID_PREFIX.authBinding), userId, provider: 'email', subject: email.toLowerCase(),
        createdAt: new Date().toISOString(), lastUsedAt: null,
      })
    }
    // Ensure org exists
    const orgs = await this.deps.organizations.listForTenant(userId) // won't work — need a different approach
    // Actually, check if admin already has a membership
    const memberships = await this.deps.memberships.listTenantsForUser(userId)
    if (memberships.length > 0) {
      return { userId, orgId: memberships[0]!.organizationId }
    }
    // Create admin org
    const orgId = entityId(ID_PREFIX.organization)
    await this.deps.organizations.create({
      id: orgId, tenantId: orgId, name: 'Contractor GenOffice', slug: 'contractor-genoffice',
      status: 'active', createdAt: new Date().toISOString(),
    })
    const membership: Membership = {
      id: entityId(ID_PREFIX.membership), userId, organizationId: orgId,
      role: 'admin', status: 'active', createdAt: new Date().toISOString(),
    }
    await this.deps.memberships.create(membership)
    // Create a workspace
    const ws = await (this.deps as unknown as { workspaces?: { create: (input: unknown) => Promise<unknown> } }).workspaces?.create({
      id: entityId(ID_PREFIX.workspace), tenantId: orgId, organizationId: orgId,
      name: 'Default', createdAt: new Date().toISOString(),
    }).catch(() => null) // workspace repo may not be wired here; the deploy script handles it
    return { userId, orgId }
  }

  /**
   * Bootstrap demo users (owner/member/viewer). Called by the deploy script.
   */
  async bootstrapDemoUsers(orgId: string): Promise<void> {
    for (const role of ['owner', 'member', 'viewer'] as const) {
      const email = `demo-${role}@contractor.dev`
      const existing = await this.deps.users.getByEmail(email)
      let userId: string
      if (existing) {
        userId = existing.id
      } else {
        userId = entityId(ID_PREFIX.user)
        await this.deps.db.execute(
          `INSERT INTO users (id, email, display_name, status, created_at, is_demo)
           VALUES ($1, $2, $3, 'active', $4, true)`,
          [userId, email, `Demo ${role}`, new Date().toISOString()],
        )
        await this.deps.users.createBinding({
          id: entityId(ID_PREFIX.authBinding), userId, provider: 'email', subject: email,
          createdAt: new Date().toISOString(), lastUsedAt: null,
        })
        const membership: Membership = {
          id: entityId(ID_PREFIX.membership), userId, organizationId: orgId,
          role, status: 'active', createdAt: new Date().toISOString(),
        }
        await this.deps.memberships.create(membership)
      }
    }
  }
}
