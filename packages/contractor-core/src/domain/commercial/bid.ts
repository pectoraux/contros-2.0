/**
 * Bid — a commercial decision derived from an EstimateRevision.
 *
 * A Bid is NOT an independent pricing authority. It REFERENCES a finalized
 * EstimateRevision and may carry a final price + director adjustment.
 * The commercial truth lives in the EstimateRevision; the Bid is the
 * commercial decision (submit / won / lost) that references it.
 * (Phase 2A §15.)
 *
 * PURE contract — no persistence, no UI, no Electron.
 */

import type { Money } from './money.js'
import type { EstimateRevision } from './estimate-revision.js'

export type BidStatus =
  | 'draft'
  | 'submitted'
  | 'won'
  | 'lost'
  | 'withdrawn'

/**
 * A Bid — a commercial decision referencing an EstimateRevision.
 *
 * The Bid does NOT duplicate the estimate payload (unless justified).
 * It references the EstimateRevision by revisionId. The finalPrice may
 * differ from the EstimateRevision's totalSellPrice (e.g. director
 * adjustment). The Bid records the decision + outcome.
 */
export interface Bid {
  readonly __brand: 'Bid'
  readonly bidId: string
  readonly projectId: string
  /** The finalized EstimateRevision this bid references. */
  readonly estimateRevisionId: string
  /** The content hash of the referenced EstimateRevision (provenance). */
  readonly estimateRevisionContentHash: string
  readonly status: BidStatus
  /** The final price submitted (may include director adjustment). */
  readonly finalPrice: Money | null
  /** A director adjustment applied to the revision sell price (can be negative). */
  readonly directorAdjustment: Money | null
  readonly adjustmentRationale: string | null
  /** When the bid was submitted (ISO; null if not submitted). */
  readonly submittedAt: string | null
  /** When the outcome was recorded (ISO; null if no outcome yet). */
  readonly outcomeAt: string | null
  readonly outcomeNote: string | null
}

/**
 * Validate that a Bid can transition to 'submitted'.
 *
 * A Bid cannot become 'submitted' unless:
 *   - estimateRevisionId is set (points to a finalized revision)
 *   - finalPrice is set
 *
 * (Phase 2A §15; legacy validateBidSubmission behavior.)
 */
export function validateBidSubmission(bid: Bid, revision: EstimateRevision | null): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!bid.estimateRevisionId) {
    errors.push('Bid cannot be submitted without an estimateRevisionId.')
  }
  if (!revision) {
    errors.push('The referenced estimate revision does not exist.')
  } else if (revision.metadata.status !== 'finalized') {
    errors.push(`The referenced estimate revision is not finalized (status=${revision.metadata.status}).`)
  }
  if (!bid.finalPrice) {
    errors.push('Final price is not set — cannot submit.')
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true }
}

export function bid(input: {
  bidId: string
  projectId: string
  estimateRevisionId: string
  estimateRevisionContentHash: string
  status: BidStatus
  finalPrice?: Money | null
  directorAdjustment?: Money | null
  adjustmentRationale?: string | null
  submittedAt?: string | null
  outcomeAt?: string | null
  outcomeNote?: string | null
}): Bid {
  if (!input.bidId) throw new Error('Bid: bidId required')
  if (!input.projectId) throw new Error('Bid: projectId required')
  if (!input.estimateRevisionId) throw new Error('Bid: estimateRevisionId required')
  if (!input.estimateRevisionContentHash) throw new Error('Bid: estimateRevisionContentHash required')
  return {
    __brand: 'Bid',
    bidId: input.bidId,
    projectId: input.projectId,
    estimateRevisionId: input.estimateRevisionId,
    estimateRevisionContentHash: input.estimateRevisionContentHash,
    status: input.status,
    finalPrice: input.finalPrice ?? null,
    directorAdjustment: input.directorAdjustment ?? null,
    adjustmentRationale: input.adjustmentRationale ?? null,
    submittedAt: input.submittedAt ?? null,
    outcomeAt: input.outcomeAt ?? null,
    outcomeNote: input.outcomeNote ?? null,
  } as Bid
}
