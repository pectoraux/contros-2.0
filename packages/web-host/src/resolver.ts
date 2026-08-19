/**
 * WebSessionResolver — implements CoreApi's ApiSessionResolver contract.
 *
 * On every request:
 *  1. Verifies the signed session cookie (HMAC + expiry).
 *  2. If selectedMembershipId is set, confirms via listTenantsForUser that
 *     the membership belongs to the authenticated user AND is active.
 *  3. Derives tenantId = membership.organizationId.
 *  4. Returns { provider: 'web', subject: userId, tenantId }.
 *
 * If the session is missing, invalid, or no membership is selected, returns
 * null (CoreApi will return 401). The browser NEVER supplies tenantId.
 *
 * This is the ONLY way the HTTP host learns the tenant — never from the
 * request body, URL, or headers (ADR-0008 D1, D3).
 */

import type { ApiSessionResolver } from '@contractor/core/api'
import type { UserRepository, MembershipRepository } from '@contractor/core/persistence'
import type { SessionConfig, SessionPayload } from './session.js'
import { verifySession, readSessionCookie } from './session.js'

export interface WebSessionResolverDeps {
  readonly users: UserRepository
  readonly memberships: MembershipRepository
  readonly config: SessionConfig
}

export class WebSessionResolver implements ApiSessionResolver {
  constructor(private readonly deps: WebSessionResolverDeps) {}

  async resolveSession(token: string | undefined): Promise<{
    provider: string
    subject: string
    tenantId: string
  } | null> {
    // `token` here is the raw Cookie header value passed by the HTTP host
    // (see server.ts — it passes req.headers.cookie as the "token").
    const payload = this.resolvePayload(token)
    if (!payload) return null
    // A tenant must be selected (selectedMembershipId non-null).
    if (!payload.selectedMembershipId) return null

    // Re-validate the membership server-side via listTenantsForUser.
    // This confirms the membership belongs to the authenticated user AND is active,
    // without requiring a tenant context (which we don't have yet — we're resolving it).
    const userMemberships = await this.deps.memberships.listTenantsForUser(payload.userId)
    const found = userMemberships.find((m) => m.id === payload.selectedMembershipId)
    if (!found) return null // forged, revoked, or stale
    return { provider: 'web', subject: payload.userId, tenantId: found.organizationId }
  }

  /**
   * Resolve the session payload (without a tenant) — used by auth routes
   * that need the userId but not a tenant context (login, tenant selection).
   */
  resolvePayload(token: string | undefined): SessionPayload | null {
    const sessionToken = readSessionCookie(token)
    return verifySession(sessionToken, this.deps.config.sessionSecret)
  }
}
