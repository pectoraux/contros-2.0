/**
 * EstimateRevision — the canonical commercial authority.
 *
 * An EstimateRevision is the IMMUTABLE, historical commercial truth. It
 * reuses the generic RevisionMetadata from Phase 1.1 (does NOT create a
 * competing revision mechanism). The commercial payload is a snapshot of
 * EstimateLines + pricing policy, captured at finalization.
 *
 *   draft Estimate         = working state (mutable)
 *   finalized EstimateRevision = immutable commercial authority
 *
 * Same authoritative inputs + same algorithm version + same contract =
 * same content hash → same historical result. (master §13; Phase 2A §13.)
 *
 * PURE contract — no persistence, no UI, no Electron. Reuses:
 *   - RevisionMetadata (Phase 1.1 generic revision framework)
 *   - EstimateLine (the priced lines)
 *   - canonicalize/contentHash (Phase 1 deterministic hashing)
 */

import type { RevisionMetadata } from '../types.js'
import type { EstimateLine, CostBasis, PricingStrategy } from './estimate-line.js'
import type { Money, CurrencyCode } from './money.js'
import type { Ratio } from './pricing.js'
import {
  computeTotals,
  extendLine,
  sellPriceFromMarkup,
  sellPriceFromMargin,
  grossMargin,
  ratio,
} from './pricing.js'
import { multiply, add, subtract } from './money.js'
import { canonicalize, contentHash } from '../hashing.js'

/**
 * EstimatePolicy — the estimate-level commercial policy (overhead, contingency).
 * Applied to the sum of line costs to compute the estimate-level totals.
 *
 * Per-line pricing (markup/margin) is on EstimateLine; the policy here is
 * for estimate-level recovery (overhead, contingency) that is NOT per-line.
 */
export interface EstimatePolicy {
  readonly overheadPct: Ratio      // overhead recovery on total line cost
  readonly contingencyPct: Ratio    // contingency on total line cost
}

/**
 * EstimateRevisionPayload — the canonical commercial content.
 *
 * This is what gets content-hashed. Same payload + same algorithmVersion =
 * same content hash. (Phase 2A §13.)
 *
 * Excludes: revisionId, tenantId, createdBy, createdAt, finalizedAt, status,
 * revisionNumber — those are metadata (identity/audit), not content.
 */
export interface EstimateRevisionPayload {
  readonly __brand: 'EstimateRevisionPayload'
  readonly projectId: string
  readonly currency: CurrencyCode
  readonly policy: EstimatePolicy
  readonly lines: readonly EstimateLine[]
  /** A free-form note captured at finalization (not authoritative, but part of the snapshot). */
  readonly note: string | null
  /** The algorithm version of the pricing engine that computed the derived fields. */
  readonly pricingAlgorithmVersion: string
}

/**
 * An EstimateRevision — the full canonical authority.
 *
 * Combines the generic RevisionMetadata (identity, lifecycle, audit) with
 * the EstimateRevisionPayload (commercial content).
 */
export interface EstimateRevision {
  readonly __brand: 'EstimateRevision'
  readonly metadata: RevisionMetadata
  readonly payload: EstimateRevisionPayload
}

/**
 * Compute the canonical content hash of an EstimateRevisionPayload.
 *
 * The hash is deterministic: same payload → same hash. It uses the
 * canonicalize function (stable key ordering, no unstable fields).
 * (Phase 2A §13; master §14/§15.)
 *
 * NOTE: EstimateLine contains Money (integer minor units) + Quantity
 * (rounded to 4 decimals) + Ratio (0..1) — all deterministic. No
 * wall-clock, no Math.random, no post-calculation DB IDs. The `measuredAt`
 * on source PlanMeasurements is NOT part of the EstimateLine (it lives on
 * PlanMeasurement, which is evidence, not authority).
 */
export function estimateRevisionContentHash(payload: EstimateRevisionPayload): string {
  return contentHash(payload)
}

/**
 * Compute the estimate totals from an EstimateRevisionPayload.
 */
export interface EstimateRevisionTotals {
  readonly totalLineCost: Money
  readonly overhead: Money
  readonly contingency: Money
  readonly totalCost: Money            // line cost + overhead + contingency
  readonly totalSellPrice: Money       // sum of line sell prices
  readonly totalGrossProfit: Money     // sellPrice - totalCost
  readonly grossMargin: Ratio          // grossProfit / sellPrice
}

export function computeEstimateRevisionTotals(payload: EstimateRevisionPayload): EstimateRevisionTotals {
  const lines = payload.lines.map((l) => ({
    cost: lineCostOf(l),
    sellPrice: lineSellPriceOf(l),
  }))
  const lineTotals = computeTotals(lines, payload.currency)

  const overhead = multiply(lineTotals.totalCost, payload.policy.overheadPct)
  const contingency = multiply(lineTotals.totalCost, payload.policy.contingencyPct)
  const totalCost = add(add(lineTotals.totalCost, overhead), contingency)
  const totalGrossProfit = subtract(lineTotals.totalSellPrice, totalCost)

  return {
    totalLineCost: lineTotals.totalCost,
    overhead,
    contingency,
    totalCost,
    totalSellPrice: lineTotals.totalSellPrice,
    totalGrossProfit,
    grossMargin: grossMargin(lineTotals.totalSellPrice, totalCost),
  }
}

/**
 * Replay an EstimateRevision: reconstruct the exact commercial result
 * from the immutable payload. This is the reproducibility proof.
 *
 * Same payload + same algorithmVersion = same totals. (Phase 2A §13.)
 */
export function replayEstimateRevision(revision: EstimateRevision): EstimateRevisionTotals {
  return computeEstimateRevisionTotals(revision.payload)
}

/**
 * Verify that a revision's stored content hash matches a recomputed hash.
 * Used to prove integrity on replay.
 */
export function verifyEstimateRevisionHash(revision: EstimateRevision, expectedHash: string): boolean {
  return estimateRevisionContentHash(revision.payload) === expectedHash
}

export function estimateRevisionPayload(input: {
  projectId: string
  currency: CurrencyCode
  policy: EstimatePolicy
  lines: readonly EstimateLine[]
  note?: string | null
  pricingAlgorithmVersion: string
}): EstimateRevisionPayload {
  if (!input.projectId) throw new Error('EstimateRevisionPayload: projectId required')
  if (!input.pricingAlgorithmVersion) throw new Error('EstimateRevisionPayload: pricingAlgorithmVersion required')
  return {
    __brand: 'EstimateRevisionPayload',
    projectId: input.projectId,
    currency: input.currency,
    policy: input.policy,
    lines: input.lines,
    note: input.note ?? null,
    pricingAlgorithmVersion: input.pricingAlgorithmVersion,
  } as EstimateRevisionPayload
}

// ── local line-cost/line-sell (mirror of estimate-line.ts; deterministic) ──

function lineCostOf(line: EstimateLine): Money {
  if (line.costBasis === 'lump-sum' || line.costBasis === 'provisional') {
    return line.rate
  }
  return extendLine(line.rate, line.quantity)
}

function lineSellPriceOf(line: EstimateLine): Money {
  const cost = lineCostOf(line)
  if (line.pricingStrategy === 'markup') {
    return sellPriceFromMarkup(cost, line.pricingRatio)
  }
  return sellPriceFromMargin(cost, line.pricingRatio)
}
