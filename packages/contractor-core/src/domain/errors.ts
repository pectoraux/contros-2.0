/**
 * Domain errors. Explicit semantics for authorization and integrity
 * failures. The Core API adapter maps these to HTTP status codes.
 * (Phase 1 section 21.)
 *
 * Key invariant: cross-tenant access resolves as a NOT_FOUND or
 * UNAUTHORIZED failure, NOT as a "resource exists in another tenant"
 * leak. (Phase 1 section 21.)
 *
 * These are proper Error subclasses so `instanceof` works in tests and
 * catch blocks, and they carry a `kind` discriminator for control flow.
 */

export type DomainErrorKind =
  | 'unauthenticated'
  | 'unauthorized'
  | 'forbidden' // cross-tenant or permission denied; existence not leaked
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'immutable_revision_mutation'
  | 'immutable_audit_mutation'
  | 'internal'

/**
 * Base class for all domain errors. Carries a `kind` discriminator
 * (for control flow) and optional `details` (for the API adapter).
 * The class IS the type (no separate interface — avoids merge conflicts).
 */
export class DomainError extends Error {
  readonly kind: DomainErrorKind
  readonly details?: Readonly<Record<string, unknown>>
  constructor(kind: DomainErrorKind, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'DomainError'
    this.kind = kind
    if (details) this.details = details
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = 'Authentication required') {
    super('unauthenticated', message)
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Not authorized') {
    super('unauthorized', message)
  }
}

/**
 * Forbidden — used for cross-tenant access AND permission denial.
 * Existence of a resource in another tenant is NOT leaked: a cross-tenant
 * lookup resolves as forbidden, not as "exists elsewhere". (Phase 1 §21.)
 */
export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden') {
    super('forbidden', message)
  }
}

export class NotFoundError extends DomainError {
  constructor(entityType: string, id: string) {
    super('not_found', `${entityType} not found: ${id}`, { entityType, id })
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('validation', message, details)
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('conflict', message, details)
  }
}

/**
 * Immutable revision mutation — attempting to UPDATE or DELETE a finalized
 * or superseded revision. (Phase 1 section 14.)
 */
export class ImmutableRevisionMutationError extends DomainError {
  constructor(revisionId: string, operation: string) {
    super(
      'immutable_revision_mutation',
      `Cannot ${operation} finalized/superseded revision: ${revisionId}`,
      { revisionId, operation },
    )
  }
}

/**
 * Immutable audit mutation — attempting to UPDATE or DELETE an audit event.
 * (Phase 1 section 12.)
 */
export class ImmutableAuditMutationError extends DomainError {
  constructor(eventId: string, operation: string) {
    super(
      'immutable_audit_mutation',
      `Cannot ${operation} audit event: ${eventId}`,
      { eventId, operation },
    )
  }
}

export class InternalError extends DomainError {
  constructor(message: string) {
    super('internal', message)
  }
}

// ── HTTP mapping (used by the Core API adapter) ───────────────

export function httpStatusForError(kind: DomainErrorKind): number {
  switch (kind) {
    case 'unauthenticated':
      return 401
    case 'unauthorized':
    case 'forbidden':
      return 403
    case 'not_found':
      return 404
    case 'validation':
      return 400
    case 'conflict':
      return 409
    case 'immutable_revision_mutation':
    case 'immutable_audit_mutation':
      return 409
    case 'internal':
      return 500
  }
}

/**
 * Narrow an unknown caught value to a DomainError, or null.
 * Used in catch blocks and the API adapter.
 */
export function asDomainError(e: unknown): DomainError | null {
  if (e instanceof DomainError) return e
  return null
}
