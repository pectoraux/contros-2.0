/**
 * Revision status transition rules — PURE.
 *
 * Once a revision is FINALIZED or SUPERSEDED, it is IMMUTABLE:
 *  - UPDATE is forbidden
 *  - DELETE is forbidden
 * Corrections occur through a NEW revision that supersedes the old one.
 * (Phase 1 section 13/14; master prompt §13.)
 *
 * Allowed transitions:
 *   draft     -> finalized   (finalize)
 *   draft     -> superseded  (supersede without finalizing — e.g. discard)
 *   finalized -> superseded  (a newer finalized revision supersedes it)
 *
 * Forbidden:
 *   finalized -> draft        (cannot "un-finalize")
 *   superseded -> anything     (terminal state)
 *   any -> UPDATE/DELETE       (immutability)
 */

import type { RevisionStatus } from './types.js'
import { ImmutableRevisionMutationError } from './errors.js'

const ALLOWED_TRANSITIONS: ReadonlySet<string> = new Set([
  'draft->finalized',
  'draft->superseded',
  'finalized->superseded',
])

/**
 * Is a transition from one status to another allowed?
 */
export function canTransition(from: RevisionStatus, to: RevisionStatus): boolean {
  return ALLOWED_TRANSITIONS.has(`${from}->${to}`)
}

/**
 * Assert a transition is allowed, or throw ImmutableRevisionMutation.
 */
export function assertCanTransition(
  revisionId: string,
  from: RevisionStatus,
  to: RevisionStatus,
): void {
  if (!canTransition(from, to)) {
    throw new ImmutableRevisionMutationError(
      revisionId,
      `transition ${from}->${to}`,
    )
  }
}

/**
 * Is a revision in an immutable state (finalized or superseded)?
 * Such revisions CANNOT be updated or deleted.
 */
export function isImmutable(status: RevisionStatus): boolean {
  return status === 'finalized' || status === 'superseded'
}

/**
 * Is a revision mutable (only 'draft')?
 */
export function isMutable(status: RevisionStatus): boolean {
  return status === 'draft'
}

/**
 * Assert a revision is mutable; throw if it is not. Used by repositories
 * before any UPDATE/DELETE attempt on revision data.
 */
export function assertMutable(revisionId: string, status: RevisionStatus): void {
  if (!isMutable(status)) {
    throw new ImmutableRevisionMutationError(revisionId, `mutate (status=${status})`)
  }
}

/**
 * Is a status a valid revision status?
 */
export function isValidStatus(status: unknown): status is RevisionStatus {
  return (
    typeof status === 'string' &&
    (status === 'draft' || status === 'finalized' || status === 'superseded')
  )
}
