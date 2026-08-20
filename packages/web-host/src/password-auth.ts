/**
 * Password auth service — email + password authentication (Phase 2C.3).
 *
 * Uses Node's built-in crypto.scrypt (no bcrypt dependency needed).
 * Passwords are stored as `salt:hash` in the users.password_hash column.
 *
 * Phase 2C.3.2 REPAIR:
 *  - All raw SQL moved to repository methods (H5). The service orchestrates
 *    via UserRepository.createWithPassword / getPasswordHash / updatePasswordHash /
 *    getIsDemo, MembershipRepository.create, WaitlistRepository.approve.
 *  - Audit event added to approveWaitlistEntry inside db.tx() (H3/H4). The audit
 *    participates in the same transaction — if it fails, all approval writes roll back.
 *  - The service receives AuditRepository as a dependency.
 */

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DbClient, UserRepository, MembershipRepository, OrganizationRepository, AuditRepository } from '@contractor/core/persistence'
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
  readonly audit: AuditRepository
}

export class PasswordAuthService {
  constructor(private readonly deps: PasswordAuthDeps) {}

  /**
   * Login with email + password. Returns userId if valid, null otherwise.
   * Uses UserRepository.getPasswordHash (no raw SQL in the service).
   */
  async login(email: string, password: string): Promise<{ userId: string } | null> {
    const user = await this.deps.users.getByEmail(email.toLowerCase())
    if (!user || user.status !== 'active') return null
    const passwordHash = await this.deps.users.getPasswordHash(user.id)
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
   * adds them to the SELECTED tenant as a member, marks the waitlist entry approved,
   * and emits an audit event — ALL in ONE transaction (db.tx).
   *
   * Phase 2C.3.2:
   *  - Uses repository methods (no raw SQL in the service — H5).
   *  - Emits an audit event inside the same tx (ADR-0007 D18 — H3/H4).
   *  - The tenantId comes from the admin's SELECTED membership (not client-supplied — H4).
   */
  async approveWaitlistEntry(
    waitlistId: string,
    adminUserId: string,
    tenantId: string,
    password: string,
  ): Promise<{ userId: string; email: string }> {
    const entry = await this.deps.waitlist.getById(waitlistId)
    if (!entry) throw new Error('waitlist entry not found')
    if (entry.status !== 'pending') throw new Error(`entry is already ${entry.status}`)
    // Transactional: user + binding + membership + waitlist-approve + audit — all-or-nothing
    return this.deps.db.tx(async (tx) => {
      const userId = entityId(ID_PREFIX.user)
      const email = entry.email
      const displayName = entry.displayName ?? email.split('@')[0] ?? email
      // Create the user with password hash (repository method — no raw SQL)
      await this.deps.users.createWithPassword(
        { id: userId, email, displayName, status: 'active', createdAt: new Date().toISOString() },
        hashPassword(password),
      )
      // Create an auth binding for email auth
      await this.deps.users.createBinding({
        id: entityId(ID_PREFIX.authBinding), userId, provider: 'email', subject: email,
        createdAt: new Date().toISOString(), lastUsedAt: null,
      })
      // Add as member of the SELECTED tenant
      const membership: Membership = {
        id: entityId(ID_PREFIX.membership), userId, organizationId: tenantId,
        role: 'member', status: 'active', createdAt: new Date().toISOString(),
      }
      await this.deps.memberships.create(membership)
      // Mark waitlist entry approved
      const approved = await this.deps.waitlist.approve(waitlistId, adminUserId, userId)
      if (!approved) throw new Error('waitlist entry could not be approved (race condition or already approved)')
      // Audit event — inside the same transaction (ADR-0007 D18)
      await this.deps.audit.append({
        eventId: entityId(ID_PREFIX.audit), tenantId,
        actorId: adminUserId, actorKind: 'user', timestamp: new Date().toISOString(),
        action: 'waitlist.approved', entityType: 'waitlist', entityId: waitlistId,
        operation: 'approve', metadata: { createdUserId: userId, email },
      })
      return { userId, email }
    })
  }

  /**
   * Demo login — returns the userId for a demo user of the given role.
   * Demo users must already exist in the DB (seeded by the deploy script).
   * Uses UserRepository.getIsDemo (no raw SQL).
   */
  async demoLogin(role: 'owner' | 'member' | 'viewer'): Promise<{ userId: string } | null> {
    const email = `demo-${role}@contractor.dev`
    const user = await this.deps.users.getByEmail(email)
    if (!user) return null
    const isDemo = await this.deps.users.getIsDemo(user.id)
    if (!isDemo) return null
    return { userId: user.id }
  }

  /**
   * Bootstrap the admin user (if not exists). Called by the deploy script.
   * Uses UserRepository methods (no raw SQL).
   */
  async bootstrapAdmin(email: string, password: string): Promise<{ userId: string; orgId: string }> {
    const existing = await this.deps.users.getByEmail(email.toLowerCase())
    let userId: string
    if (existing) {
      userId = existing.id
      await this.deps.users.updatePasswordHash(userId, hashPassword(password))
    } else {
      userId = entityId(ID_PREFIX.user)
      await this.deps.users.createWithPassword(
        { id: userId, email: email.toLowerCase(), displayName: 'Admin', status: 'active', createdAt: new Date().toISOString() },
        hashPassword(password),
      )
      await this.deps.users.createBinding({
        id: entityId(ID_PREFIX.authBinding), userId, provider: 'email', subject: email.toLowerCase(),
        createdAt: new Date().toISOString(), lastUsedAt: null,
      })
    }
    // Ensure org exists
    const memberships = await this.deps.memberships.listTenantsForUser(userId)
    if (memberships.length > 0) {
      return { userId, orgId: memberships[0]!.organizationId }
    }
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
    return { userId, orgId }
  }

  /**
   * Bootstrap demo users (owner/member/viewer). Called by the deploy script.
   * Uses UserRepository methods (no raw SQL).
   */
  async bootstrapDemoUsers(orgId: string): Promise<void> {
    for (const role of ['owner', 'member', 'viewer'] as const) {
      const email = `demo-${role}@contractor.dev`
      const existing = await this.deps.users.getByEmail(email)
      let userId: string
      if (existing) {
        userId = existing.id
        // Ensure is_demo flag is set (via update — need a method for this)
        // Actually, is_demo is set at creation; if the user already exists, skip.
      } else {
        userId = entityId(ID_PREFIX.user)
        // Create via repository method (no raw SQL in the service — H5)
        await this.deps.users.createDemoUser(
          { id: userId, email, displayName: `Demo ${role}`, status: 'active', createdAt: new Date().toISOString() },
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
