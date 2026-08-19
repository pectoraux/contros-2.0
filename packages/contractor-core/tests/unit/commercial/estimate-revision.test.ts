/**
 * EstimateRevision replayability tests — the reproducibility proof.
 *
 * Proves: same inputs + same algorithm version + same contract =
 * same content hash → same totals. (Phase 2A §13.)
 *
 * Also proves: changing ANY authoritative input changes the content hash.
 *
 * Pure, deterministic. No DB, no network, no filesystem.
 */

import { describe, it, expect } from 'vitest'
import {
  estimateRevisionPayload, estimateRevisionContentHash,
  computeEstimateRevisionTotals, replayEstimateRevision,
  type EstimateRevision, type EstimateRevisionPayload,
} from '../../../src/domain/commercial/estimate-revision.js'
import { estimateLine } from '../../../src/domain/commercial/estimate-line.js'
import { money } from '../../../src/domain/commercial/money.js'
import { quantity, UNITS } from '../../../src/domain/commercial/quantity.js'
import { ratio } from '../../../src/domain/commercial/pricing.js'
import { currencyCode } from '../../../src/domain/commercial/currency.js'
import type { RevisionMetadata } from '../../../src/domain/types.js'

function makeLine(id: string, desc: string, rateMinor: number, qty: number, markup: number) {
  return estimateLine({
    lineId: id, boqItemId: null, description: desc,
    quantity: quantity(qty, UNITS.SQUARE_METRE),
    costBasis: 'unit-rate', rate: moneyFromMinor(rateMinor, 'GHS'),
    pricingStrategy: 'markup', pricingRatio: ratio(markup),
  })
}

// local moneyFromMinor (avoid import churn)
import { moneyFromMinor } from '../../../src/domain/commercial/money.js'

function makePayload(lines: ReturnType<typeof makeLine>[], policyOverhead = 0.10, policyContingency = 0.05): EstimateRevisionPayload {
  return estimateRevisionPayload({
    projectId: 'proj_1', currency: currencyCode('GHS'),
    policy: { overheadPct: ratio(policyOverhead), contingencyPct: ratio(policyContingency) },
    lines, note: 'test estimate', pricingAlgorithmVersion: 'v1',
  })
}

function makeRevision(payload: EstimateRevisionPayload): EstimateRevision {
  const metadata: RevisionMetadata = {
    revisionId: 'rev_1', tenantId: 'org_1', projectId: 'proj_1',
    authorityKind: 'estimate', revisionNumber: 1, status: 'finalized',
    createdBy: 'usr_1', createdAt: '2026-01-01T00:00:00.000Z',
    algorithmVersion: 'v1',
    contentHash: estimateRevisionContentHash(payload),
    parentRevisionId: null, finalizedAt: '2026-01-01T00:00:00.000Z',
  }
  return { __brand: 'EstimateRevision', metadata, payload }
}

describe('EstimateRevision: replayability (reproducibility proof)', () => {
  it('same payload → same content hash (deterministic)', () => {
    const payload1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    const payload2 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    expect(estimateRevisionContentHash(payload1)).toBe(estimateRevisionContentHash(payload2))
  })

  it('same payload → same totals (deterministic replay)', () => {
    const payload = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    const rev1 = makeRevision(payload)
    const rev2 = makeRevision(payload)
    const t1 = replayEstimateRevision(rev1)
    const t2 = replayEstimateRevision(rev2)
    expect(t1).toEqual(t2)
  })

  it('changing the rate changes the content hash', () => {
    const p1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    const p2 = makePayload([makeLine('l1', 'Concrete', 501, 100, 0.20)]) // 5.01 vs 5.00
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })

  it('changing the quantity changes the content hash', () => {
    const p1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    const p2 = makePayload([makeLine('l1', 'Concrete', 500, 101, 0.20)])
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })

  it('changing the markup changes the content hash', () => {
    const p1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    const p2 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.21)])
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })

  it('changing the policy changes the content hash', () => {
    const p1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)], 0.10, 0.05)
    const p2 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)], 0.11, 0.05)
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })

  it('changing the note changes the content hash', () => {
    const p1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    const p2 = { ...p1, note: 'changed note' } as EstimateRevisionPayload
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })

  it('changing the algorithm version changes the content hash', () => {
    const p1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    const p2 = { ...p1, pricingAlgorithmVersion: 'v2' } as EstimateRevisionPayload
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })

  it('adding a line changes the content hash', () => {
    const p1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    const p2 = makePayload([
      makeLine('l1', 'Concrete', 500, 100, 0.20),
      makeLine('l2', 'Steel', 1000, 50, 0.15),
    ])
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })

  it('line order matters (different order → different hash)', () => {
    const l1 = makeLine('l1', 'Concrete', 500, 100, 0.20)
    const l2 = makeLine('l2', 'Steel', 1000, 50, 0.15)
    const p1 = makePayload([l1, l2])
    const p2 = makePayload([l2, l1])
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })
})

describe('EstimateRevision: totals computation', () => {
  it('single line: cost + overhead + contingency + sell + profit', () => {
    // line: rate=GHS 5.00/m2 (500 minor), qty=100 m2, markup=20%
    // lineCost = 500 × 100 = 50000 minor = GHS 500.00
    // lineSell = 500 × 1.20 = 60000 minor = GHS 600.00
    // policy: overhead=10%, contingency=5%
    // overhead = 50000 × 0.10 = 5000 minor
    // contingency = 50000 × 0.05 = 2500 minor
    // totalCost = 50000 + 5000 + 2500 = 57500 minor = GHS 575.00
    // totalSell = 60000 minor = GHS 600.00
    // totalGrossProfit = 60000 - 57500 = 2500 minor = GHS 25.00
    // grossMargin = 2500 / 60000 = 0.04167
    const payload = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    const totals = computeEstimateRevisionTotals(payload)
    expect(totals.totalLineCost.amount).toBe(50000)
    expect(totals.overhead.amount).toBe(5000)
    expect(totals.contingency.amount).toBe(2500)
    expect(totals.totalCost.amount).toBe(57500)
    expect(totals.totalSellPrice.amount).toBe(60000)
    expect(totals.totalGrossProfit.amount).toBe(2500)
    expect(totals.grossMargin).toBeCloseTo(2500 / 60000, 4)
  })

  it('multi-line totals sum correctly', () => {
    const payload = makePayload([
      makeLine('l1', 'Concrete', 500, 100, 0.20),  // cost 50000, sell 60000
      makeLine('l2', 'Steel', 1000, 50, 0.15),      // cost 50000, sell 57500
    ])
    const totals = computeEstimateRevisionTotals(payload)
    expect(totals.totalLineCost.amount).toBe(100000) // 50000 + 50000
    expect(totals.totalSellPrice.amount).toBe(117500) // 60000 + 57500
    // overhead = 100000 × 0.10 = 10000, contingency = 100000 × 0.05 = 5000
    expect(totals.totalCost.amount).toBe(115000) // 100000 + 10000 + 5000
    expect(totals.totalGrossProfit.amount).toBe(2500) // 117500 - 115000
  })
})

describe('EstimateRevision: hash does not include metadata (identity/audit)', () => {
  it('two revisions with same payload but different revisionId have same content hash', () => {
    const payload = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    const rev1 = makeRevision(payload)
    const rev2 = { ...rev1, metadata: { ...rev1.metadata, revisionId: 'rev_DIFFERENT' } }
    // content hash is computed from PAYLOAD, not metadata
    expect(estimateRevisionContentHash(rev1.payload)).toBe(estimateRevisionContentHash(rev2.payload))
  })
})
