/**
 * TenantContext — the trusted context object.
 *
 * PURE module. Creates and validates TenantContext value objects.
 * The context originates from the authenticated session (resolved
 * server-side), NEVER from request body, URL, frontend selector, or
 * client project choice. (Phase 1 section 6; ADR-0005 Decision 2.)
 *
 * Invariants (enforced here, not by caller discipline):
 *  - tenantId is a non-empty string
 *  - actor is present (user or service)
 *  - if actor is a user, membership (if present) belongs to the same
 *    tenant as tenantId — a mismatch is an INVALID context (the factory
 *    throws; this is a server-side bug, not a client error)
 *  - the context is deeply frozen (immutable)
 */

import type {
  Actor,
  Membership,
  Permission,
  TenantContext,
} from './types.js'
import { UnauthorizedError } from './errors.js'
import { permissionsForRole } from './membership.js'

/**
 * Create a TenantContext for a USER in a tenant.
 *
 * @param tenantId  the tenant (organization id) — resolved from session
 * @param userId    the authenticated user's id
 * @param membership the user's membership in this tenant (null if none)
 *
 * If membership is null, the context is valid but has no permissions
 * (the user is not a member of this tenant → all tenant-scoped operations
 * will fail authorization). This is the correct behavior for an
 * authenticated user who has no membership in the requested tenant.
 *
 * If membership is present, its organizationId MUST match tenantId —
 * otherwise this is a server-side bug (the factory throws).
 */
export function createTenantContext(
  tenantId: string,
  userId: string,
  membership: Membership | null,
): TenantContext {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('TenantContext: tenantId is required')
  }
  if (!userId || typeof userId !== 'string') {
    throw new Error('TenantContext: userId is required')
  }
  if (membership && membership.organizationId !== tenantId) {
    // Server-side invariant violation: the membership does not belong to
    // this tenant. This must NEVER happen in correct code; if it does,
    // it is a bug, not a client error.
    throw new Error(
      `TenantContext invariant violation: membership.organizationId ` +
        `(${membership.organizationId}) !== tenantId (${tenantId})`,
    )
  }
  const actor: Actor = { kind: 'user', userId }
  const permissions = membership
    ? permissionsForRole(membership.role)
    : new Set<Permission>()
  return deepFreeze({
    tenantId,
    actor,
    membership,
    permissions,
  })
}

/**
 * Create a TenantContext for a SERVICE principal (e.g. migration runner).
 * Service principals are not "members" but may hold explicit permissions.
 */
export function createServiceTenantContext(
  tenantId: string,
  serviceId: string,
  label: string,
  permissions: ReadonlySet<Permission> = new Set<Permission>(),
): TenantContext {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('TenantContext: tenantId is required')
  }
  if (!serviceId || typeof serviceId !== 'string') {
    throw new Error('TenantContext: serviceId is required')
  }
  const actor: Actor = { kind: 'service', serviceId, label }
  return deepFreeze({
    tenantId,
    actor,
    membership: null,
    permissions,
  })
}

/**
 * Require a permission in the context. Returns the context (for chaining)
 * or throws Unauthorized if the permission is absent.
 *
 * Used by application services before modifying tenant data:
 *   requirePermission(ctx, 'project:write')
 */
export function requirePermission(ctx: TenantContext, perm: Permission): TenantContext {
  if (!ctx.permissions.has(perm)) {
    throw new UnauthorizedError(
      `Actor ${ctx.actor.kind}:${ctx.actor.kind === 'user' ? ctx.actor.userId : ctx.actor.serviceId} ` +
        `lacks permission ${perm} in tenant ${ctx.tenantId}`,
    )
  }
  return ctx
}

/**
 * Does the context have a permission? (non-throwing check)
 */
export function hasPermission(ctx: TenantContext, perm: Permission): boolean {
  return ctx.permissions.has(perm)
}

/**
 * The actor's id (user or service) for audit recording.
 */
export function actorIdOf(ctx: TenantContext): string {
  return ctx.actor.kind === 'user' ? ctx.actor.userId : ctx.actor.serviceId
}

// ── deep freeze (the context is a frozen value object) ───────

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj)
    for (const v of Object.values(obj as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Object.isFrozen(v)) {
        deepFreeze(v)
      }
    }
  }
  return obj
}
