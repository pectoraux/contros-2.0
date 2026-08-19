/**
 * Bid linkage tests — Bid references EstimateRevision, not independent.
 * (Phase 2A §15.)
 */

import { describe, it, expect } from 'vitest'
import { bid, validateBidSubmission } from '../../../src/domain/commercial/bid.js'
import { money, moneyFromMinor } from '../../../src/domain/commercial/money.js'
import {
  estimateRevisionPayload, estimateRevisionContentHash,
  type EstimateRevision,
} from '../../../src/domain/commercial/estimate-revision.js'
import { estimateLine } from '../../../src/domain/commercial/estimate-line.js'
import { quantity, UNITS } from '../../../src/domain/commercial/quantity.js'
import { ratio } from '../../../src/domain/commercial/pricing.js'
import { currencyCode } from '../../../src/domain/commercial/currency.js'
import type { RevisionMetadata } from '../../../src/domain/types.js'

function makeFinalizedRevision(): EstimateRevision {
  const payload = estimateRevisionPayload({
    projectId: 'proj_1', currency: currencyCode('GHS'),
    policy: { overheadPct: ratio(0.10), contingencyPct: ratio(0.05), targetProfitMode: 'markup', targetProfitRatio: ratio(0.10) },
    lines: [estimateLine({
      lineId: 'l1', boqItemId: null, description: 'Concrete',
      quantity: quantity(100, UNITS.SQUARE_METRE),
      costBasis: 'unit-rate', rate: moneyFromMinor(500, 'GHS'),
      pricingStrategy: 'markup', pricingRatio: ratio(0.20),
    })],
    pricingAlgorithmVersion: 'v1',
  })
  const metadata: RevisionMetadata = {
    revisionId: 'rev_1', tenantId: 'org_1', projectId: 'proj_1',
    authorityKind: 'estimate', revisionNumber: 1, status: 'finalized',
    createdBy: 'usr_1', createdAt: '2026-01-01T00:00:00.000Z',
    algorithmVersion: 'v1', contentHash: estimateRevisionContentHash(payload),
    parentRevisionId: null, finalizedAt: '2026-01-01T00:00:00.000Z',
  }
  return { __brand: 'EstimateRevision', metadata, payload }
}

describe('Bid: references EstimateRevision (not independent authority)', () => {
  it('a Bid references estimateRevisionId + contentHash', () => {
    const rev = makeFinalizedRevision()
    const b = bid({
      bidId: 'bid_1', projectId: 'proj_1',
      estimateRevisionId: rev.metadata.revisionId,
      estimateRevisionContentHash: estimateRevisionContentHash(rev.payload),
      status: 'draft',
    })
    expect(b.estimateRevisionId).toBe('rev_1')
    expect(b.estimateRevisionContentHash).toBe(estimateRevisionContentHash(rev.payload))
    expect(b.status).toBe('draft')
    expect(b.finalPrice).toBeNull()
  })

  it('validateBidSubmission: finalized revision + finalPrice → ok', () => {
    const rev = makeFinalizedRevision()
    const b = bid({
      bidId: 'bid_1', projectId: 'proj_1',
      estimateRevisionId: 'rev_1',
      estimateRevisionContentHash: estimateRevisionContentHash(rev.payload),
      status: 'draft', finalPrice: money(600.00, 'GHS'),
    })
    const result = validateBidSubmission(b, rev)
    expect(result.ok).toBe(true)
  })

  it('validateBidSubmission: draft revision → rejected', () => {
    const rev = makeFinalizedRevision()
    const draftRev = { ...rev, metadata: { ...rev.metadata, status: 'draft' as const } }
    const b = bid({
      bidId: 'bid_1', projectId: 'proj_1',
      estimateRevisionId: 'rev_1',
      estimateRevisionContentHash: estimateRevisionContentHash(rev.payload),
      status: 'draft', finalPrice: money(600.00, 'GHS'),
    })
    const result = validateBidSubmission(b, draftRev)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors.some((e) => e.includes('not finalized'))).toBe(true)
  })

  it('validateBidSubmission: missing finalPrice → rejected', () => {
    const rev = makeFinalizedRevision()
    const b = bid({
      bidId: 'bid_1', projectId: 'proj_1',
      estimateRevisionId: 'rev_1',
      estimateRevisionContentHash: estimateRevisionContentHash(rev.payload),
      status: 'draft', // no finalPrice
    })
    const result = validateBidSubmission(b, rev)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors.some((e) => e.includes('Final price'))).toBe(true)
  })

  it('validateBidSubmission: missing revision → rejected', () => {
    const rev = makeFinalizedRevision()
    const b = bid({
      bidId: 'bid_1', projectId: 'proj_1',
      estimateRevisionId: 'rev_MISSING',
      estimateRevisionContentHash: estimateRevisionContentHash(rev.payload),
      status: 'draft', finalPrice: money(600.00, 'GHS'),
    })
    const result = validateBidSubmission(b, null) // revision not found
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors.some((e) => e.includes('does not exist'))).toBe(true)
  })

  it('a Bid does NOT duplicate the estimate payload', () => {
    const rev = makeFinalizedRevision()
    const b = bid({
      bidId: 'bid_1', projectId: 'proj_1',
      estimateRevisionId: rev.metadata.revisionId,
      estimateRevisionContentHash: estimateRevisionContentHash(rev.payload),
      status: 'draft',
    })
    // Bid has NO lines, NO policy, NO pricing — only a reference + hash
    expect((b as unknown as Record<string, unknown>).lines).toBeUndefined()
    expect((b as unknown as Record<string, unknown>).policy).toBeUndefined()
    expect((b as unknown as Record<string, unknown>).payload).toBeUndefined()
  })
})
