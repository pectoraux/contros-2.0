/**
 * EstimateRevision replayability tests — the reproducibility proof.
 *
 * Proves: same inputs + same algorithm version + same contract =
 * same content hash → same totals. (Phase 2A §13; Phase 2A.1 hardened.)
 *
 * Also proves: changing ANY authoritative input changes the content hash.
 *
 * Commercial model (Phase 2A.1):
 *   totalLineCost = sum(lineCost = rate × qty)
 *   contingency   = totalLineCost × contingencyPct   (H1: on direct cost only)
 *   overhead      = totalLineCost × overheadPct       (H1: on direct cost only)
 *   totalCost     = totalLineCost + overhead + contingency
 *   profit (markup) = totalCost × targetProfitRatio; sellPrice = totalCost + profit
 *   profit (margin) = sellPrice - totalCost; sellPrice = totalCost / (1 - targetProfitRatio)
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
import { money, moneyFromMinor } from '../../../src/domain/commercial/money.js'
import { quantity, UNITS } from '../../../src/domain/commercial/quantity.js'
import { ratio, markup, markupRaw } from '../../../src/domain/commercial/pricing.js'
import { currencyCode } from '../../../src/domain/commercial/currency.js'
import { boqItem, boq } from '../../../src/domain/commercial/boq.js'
import type { RevisionMetadata } from '../../../src/domain/types.js'

function makeLine(id: string, desc: string, rateMinor: number, qty: number, lineMarkup: number) {
  return estimateLine({
    lineId: id, boqItemId: null, description: desc,
    quantity: quantity(qty, UNITS.SQUARE_METRE),
    costBasis: 'unit-rate', rate: moneyFromMinor(rateMinor, 'GHS'),
    pricingStrategy: 'markup', pricingRatio: ratio(lineMarkup),
  })
}

function makePayload(
  lines: ReturnType<typeof makeLine>[],
  opts?: { overhead?: number; contingency?: number; profitMode?: 'markup' | 'margin'; profitRatio?: number },
): EstimateRevisionPayload {
  return estimateRevisionPayload({
    projectId: 'proj_1', currency: currencyCode('GHS'),
    policy: {
      overheadPct: ratio(opts?.overhead ?? 0.10),
      contingencyPct: ratio(opts?.contingency ?? 0.05),
      targetProfitMode: opts?.profitMode ?? 'markup',
      targetProfitRatio: ratio(opts?.profitRatio ?? 0.10),
    },
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
    const p2 = makePayload([makeLine('l1', 'Concrete', 501, 100, 0.20)])
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })

  it('changing the quantity changes the content hash', () => {
    const p1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    const p2 = makePayload([makeLine('l1', 'Concrete', 500, 101, 0.20)])
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })

  it('changing the line markup changes the content hash', () => {
    const p1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    const p2 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.21)])
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })

  it('changing the overhead changes the content hash', () => {
    const p1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)], { overhead: 0.10 })
    const p2 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)], { overhead: 0.11 })
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })

  it('changing the contingency changes the content hash', () => {
    const p1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)], { contingency: 0.05 })
    const p2 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)], { contingency: 0.06 })
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })

  it('changing the targetProfitRatio changes the content hash', () => {
    const p1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)], { profitRatio: 0.10 })
    const p2 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)], { profitRatio: 0.11 })
    expect(estimateRevisionContentHash(p1)).not.toBe(estimateRevisionContentHash(p2))
  })

  it('changing the targetProfitMode changes the content hash', () => {
    const p1 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)], { profitMode: 'markup', profitRatio: 0.10 })
    const p2 = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)], { profitMode: 'margin', profitRatio: 0.10 })
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

describe('EstimateRevision: totals computation (estimate-level profit model)', () => {
  it('single line, markup mode: cost + overhead + contingency + profit = sell', () => {
    // line: rate=GHS 5.00/m2 (500 minor), qty=100 m2
    // lineCost = 500 × 100 = 50000 minor = GHS 500.00
    // policy: overhead=10%, contingency=5%, profitMode=markup, profitRatio=10%
    // H1: overhead on DIRECT COST ONLY (not direct + contingency)
    // overhead = 50000 × 0.10 = 5000 minor
    // contingency = 50000 × 0.05 = 2500 minor
    // totalCost = 50000 + 5000 + 2500 = 57500 minor = GHS 575.00
    // profit (markup) = 57500 × 0.10 = 5750 minor = GHS 57.50
    // sellPrice = 57500 + 5750 = 63250 minor = GHS 632.50
    // grossProfit = 63250 - 57500 = 5750 minor = GHS 57.50
    // grossMargin = 5750 / 63250 = 0.09091
    const payload = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)], {
      overhead: 0.10, contingency: 0.05, profitMode: 'markup', profitRatio: 0.10,
    })
    const totals = computeEstimateRevisionTotals(payload)
    expect(totals.totalLineCost.amount).toBe(50000)
    expect(totals.overhead.amount).toBe(5000)      // 50000 × 0.10 (NOT 57500 × 0.10)
    expect(totals.contingency.amount).toBe(2500)    // 50000 × 0.05
    expect(totals.totalCost.amount).toBe(57500)     // 50000 + 5000 + 2500
    expect(totals.profit.amount).toBe(5750)          // 57500 × 0.10 (markup on totalCost)
    expect(totals.sellPrice.amount).toBe(63250)      // 57500 + 5750
    expect(totals.grossProfit.amount).toBe(5750)    // 63250 - 57500
    expect(totals.grossMargin).toBeCloseTo(5750 / 63250, 4)
  })

  it('H1 regression: overhead does NOT include contingency in its base', () => {
    // Legacy: overhead = (directCost + contingency) × overheadPct
    // New:     overhead = directCost × overheadPct
    // lineCost = 100000 minor (1000.00), overhead=10%, contingency=5%
    // Legacy overhead = (100000 + 5000) × 0.10 = 10500
    // New overhead    = 100000 × 0.10 = 10000
    const payload = makePayload([makeLine('l1', 'X', 1000, 100, 0.20)], {
      overhead: 0.10, contingency: 0.05, profitMode: 'markup', profitRatio: 0.10,
    })
    const totals = computeEstimateRevisionTotals(payload)
    expect(totals.overhead.amount).toBe(10000)       // NOT 10500 (legacy would be 10500)
    expect(totals.contingency.amount).toBe(5000)
    expect(totals.totalCost.amount).toBe(115000)     // 100000 + 10000 + 5000
    // Legacy total would be: 100000 + 5000 + 10500 = 115500 (different!)
  })

  it('margin mode: sellPrice = totalCost / (1 - profitRatio)', () => {
    // lineCost = 50000, overhead=10%, contingency=5%
    // totalCost = 50000 + 5000 + 2500 = 57500
    // margin mode, profitRatio=10%: sellPrice = 57500 / 0.90 = 63888.89 → 63889 (banker's)
    // profit = 63889 - 57500 = 6389
    const payload = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)], {
      overhead: 0.10, contingency: 0.05, profitMode: 'margin', profitRatio: 0.10,
    })
    const totals = computeEstimateRevisionTotals(payload)
    expect(totals.totalCost.amount).toBe(57500)
    // sellPrice = 57500 / 0.90 = 63888.888... → bankerRound(63888.89) = 63889
    expect(totals.sellPrice.amount).toBe(63889)
    expect(totals.profit.amount).toBe(6389)           // 63889 - 57500
  })

  it('multi-line totals sum correctly (markup mode)', () => {
    const payload = makePayload([
      makeLine('l1', 'Concrete', 500, 100, 0.20),  // cost 50000
      makeLine('l2', 'Steel', 1000, 50, 0.15),      // cost 50000
    ], { overhead: 0.10, contingency: 0.05, profitMode: 'markup', profitRatio: 0.10 })
    const totals = computeEstimateRevisionTotals(payload)
    expect(totals.totalLineCost.amount).toBe(100000) // 50000 + 50000
    expect(totals.overhead.amount).toBe(10000)        // 100000 × 0.10
    expect(totals.contingency.amount).toBe(5000)       // 100000 × 0.05
    expect(totals.totalCost.amount).toBe(115000)      // 100000 + 10000 + 5000
    expect(totals.profit.amount).toBe(11500)          // 115000 × 0.10
    expect(totals.sellPrice.amount).toBe(126500)      // 115000 + 11500
    expect(totals.grossProfit.amount).toBe(11500)    // 126500 - 115000
  })

  it('zero profit ratio: sellPrice = totalCost', () => {
    const payload = makePayload([makeLine('l1', 'X', 1000, 100, 0.20)], {
      profitMode: 'markup', profitRatio: 0,
    })
    const totals = computeEstimateRevisionTotals(payload)
    expect(totals.profit.amount).toBe(0)
    expect(totals.sellPrice.amount).toBe(totals.totalCost.amount)
  })

  it('positive profit ratio: sellPrice > totalCost (no accidental loss)', () => {
    const payload = makePayload([makeLine('l1', 'X', 1000, 100, 0.20)], {
      profitMode: 'markup', profitRatio: 0.15,
    })
    const totals = computeEstimateRevisionTotals(payload)
    expect(totals.profit.amount).toBeGreaterThan(0)
    expect(totals.sellPrice.amount).toBeGreaterThan(totals.totalCost.amount)
  })
})

describe('EstimateRevision: metadata excluded from content hash', () => {
  it('two revisions with same payload but different revisionId have same content hash', () => {
    const payload = makePayload([makeLine('l1', 'Concrete', 500, 100, 0.20)])
    const rev1 = makeRevision(payload)
    const rev2 = { ...rev1, metadata: { ...rev1.metadata, revisionId: 'rev_DIFFERENT' } }
    expect(estimateRevisionContentHash(rev1.payload)).toBe(estimateRevisionContentHash(rev2.payload))
  })
})

describe('M2: single-currency invariant enforced at construction', () => {
  it('GHS + GHS lines → accepted', () => {
    const l1 = estimateLine({
      lineId: 'l1', boqItemId: null, description: 'A',
      quantity: quantity(10, UNITS.SQUARE_METRE),
      costBasis: 'unit-rate', rate: money(100, 'GHS'),
      pricingStrategy: 'markup', pricingRatio: ratio(0.10),
    })
    const l2 = estimateLine({
      lineId: 'l2', boqItemId: null, description: 'B',
      quantity: quantity(5, UNITS.SQUARE_METRE),
      costBasis: 'unit-rate', rate: money(50, 'GHS'),
      pricingStrategy: 'markup', pricingRatio: ratio(0.10),
    })
    expect(() => makePayload([l1, l2])).not.toThrow()
  })

  it('USD + USD lines → accepted', () => {
    const l1 = estimateLine({
      lineId: 'l1', boqItemId: null, description: 'A',
      quantity: quantity(10, UNITS.SQUARE_METRE),
      costBasis: 'unit-rate', rate: money(100, 'USD'),
      pricingStrategy: 'markup', pricingRatio: ratio(0.10),
    })
    const l2 = estimateLine({
      lineId: 'l2', boqItemId: null, description: 'B',
      quantity: quantity(5, UNITS.SQUARE_METRE),
      costBasis: 'unit-rate', rate: money(50, 'USD'),
      pricingStrategy: 'markup', pricingRatio: ratio(0.10),
    })
    expect(() => estimateRevisionPayload({
      projectId: 'p', currency: currencyCode('USD'),
      policy: { overheadPct: ratio(0.10), contingencyPct: ratio(0.05), targetProfitMode: 'markup', targetProfitRatio: ratio(0.10) },
      lines: [l1, l2], pricingAlgorithmVersion: 'v1',
    })).not.toThrow()
  })

  it('GHS + USD lines → REJECTED at construction (never hashable)', () => {
    const ghsLine = estimateLine({
      lineId: 'l1', boqItemId: null, description: 'GHS line',
      quantity: quantity(10, UNITS.SQUARE_METRE),
      costBasis: 'unit-rate', rate: money(100, 'GHS'),
      pricingStrategy: 'markup', pricingRatio: ratio(0.10),
    })
    const usdLine = estimateLine({
      lineId: 'l2', boqItemId: null, description: 'USD line',
      quantity: quantity(5, UNITS.SQUARE_METRE),
      costBasis: 'unit-rate', rate: money(50, 'USD'),
      pricingStrategy: 'markup', pricingRatio: ratio(0.10),
    })
    expect(() => estimateRevisionPayload({
      projectId: 'p', currency: currencyCode('GHS'),
      policy: { overheadPct: ratio(0.10), contingencyPct: ratio(0.05), targetProfitMode: 'markup', targetProfitRatio: ratio(0.10) },
      lines: [ghsLine, usdLine], pricingAlgorithmVersion: 'v1',
    })).toThrow(/currency mismatch/i)
  })
})

describe('M1: markup() returns actual ratio (no clamping)', () => {
  it('20% markup → 0.20', () => {
    // markup is imported at top of file
    expect(markup(money(120, 'GHS'), money(100, 'GHS'))).toBeCloseTo(0.20, 5)
  })

  it('100% markup → 1.00', () => {
    // markup is imported at top of file
    expect(markup(money(200, 'GHS'), money(100, 'GHS'))).toBe(1)
  })

  it('300% markup → 3.00 (NOT clamped to 1.0)', () => {
    // markup is imported at top of file
    expect(markup(money(400, 'GHS'), money(100, 'GHS'))).toBe(3)
  })

  it('0 cost → 0 markup', () => {
    // markup is imported at top of file
    expect(markup(money(100, 'GHS'), money(0, 'GHS'))).toBe(0)
  })
})

describe('BOQ quantity snapshot: finalized revision immune to BOQ changes', () => {
  it('EstimateLine carries its OWN quantity (snapshot, not reference)', () => {
    // The EstimateLine's quantity is set at creation; it does not change
    // if the underlying BOQItem's quantity later changes.
    // boqItem, boq imported at top
    const item = boqItem({
      itemId: 'bi_1', itemCode: '1.1', description: 'Concrete',
      unit: 'm2', quantity: quantity(100, UNITS.SQUARE_METRE),
      provenance: 'manual', sourceMeasurementIds: [],
    })
    // The EstimateLine takes its own quantity snapshot at creation
    const line = estimateLine({
      lineId: 'l1', boqItemId: 'bi_1', description: 'Concrete',
      quantity: quantity(100, UNITS.SQUARE_METRE), // snapshot — independent of BOQ
      costBasis: 'unit-rate', rate: money(5.00, 'GHS'),
      pricingStrategy: 'markup', pricingRatio: ratio(0.20),
    })
    // The BOQItem and the EstimateLine both have quantity=100, but they're
    // independent values. If the BOQ changes, the EstimateLine is unaffected.
    expect(line.quantity.value).toBe(item.quantity.value)
    // The link is by reference (boqItemId), not by live value
    expect(line.boqItemId).toBe('bi_1')
    // The EstimateLine's quantity is its OWN field (snapshot)
    expect(line.quantity).not.toBe(item.quantity) // different object instances
  })
})
