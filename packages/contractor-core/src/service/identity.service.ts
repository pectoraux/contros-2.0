/**
 * Identity service — user creation + auth-provider binding + TenantContext
 * resolution from the authenticated session.
 *
 * Authentication (who are you?) is resolved here from an AuthProvider
 * binding. Authorization (may you act in this tenant?) is resolved via
 * Membership. Tenant isolation is enforced downstream by repositories.
 * (Phase 1 section 5/6/11; ADR-0005 Q4 Decision.)
 */

import type { UserRepository, MembershipRepository } from '../persistence/index.js'
import type { TenantContext, User, AuthProviderBinding, Membership, Actor } from '../domain/types.js'
import { createTenantContext } from '../domain/tenant-context.js'
import { ID_PREFIX, entityId } from '../domain/ids.js'
import { UnauthorizedError, NotFoundError } from '../domain/errors.js'

export interface ResolveTenantContextResult {
  ctx: TenantContext
  user: User
  membership: Membership | null
}

export class IdentityService {
  constructor(
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  /**
   * Resolve a TenantContext from an authenticated session.
   *
   * The session provides (provider, subject) from the AuthProvider binding.
   * The tenantId is resolved SERVER-SIDE from the membership — never from
   * the client. (Phase 1 section 6: "It must never originate from request
   * body, URL tenantId, frontend selector, hidden form field, client
   * project choice.")
   */
  async resolveTenantContext(
    provider: string,
    subject: string,
    tenantId: string,
  ): Promise<ResolveTenantContextResult> {
    // 1. Authenticate: resolve the user from the auth binding
    const binding = await this.users.getBindingBySubject(provider, subject)
    if (!binding) throw new UnauthorizedError('No auth binding for provider/subject')
    const user = await this.users.getById(binding.userId)
    if (!user) throw new UnauthorizedError('User not found for auth binding')
    if (user.status !== 'active') throw new UnauthorizedError('User is disabled')

    // 2. Authorize: resolve the membership in the requested tenant
    const membership = await this.memberships.getForUserInTenant(user.id, tenantId)

    // 3. Build the trusted TenantContext (membership org must match tenantId;
    //    the factory enforces this invariant)
    const ctx = createTenantContext(tenantId, user.id, membership)

    return { ctx, user, membership }
  }

  async createUser(email: string | null, displayName: string | null): Promise<User> {
    return this.users.create({
      id: entityId(ID_PREFIX.user),
      email,
      displayName,
      status: 'active',
      createdAt: new Date().toISOString(),
    })
  }

  async bindAuthProvider(
    userId: string,
    provider: string,
    subject: string,
  ): Promise<AuthProviderBinding> {
    // Check for existing binding (idempotent)
    const existing = await this.users.getBindingBySubject(provider, subject)
    if (existing) return existing
    return this.users.createBinding({
      id: entityId(ID_PREFIX.authBinding),
      userId,
      provider,
      subject,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    })
  }
}
