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
 * COMMERCIAL MODEL (Phase 2A.1 — hardened):
 *
 *   totalLineCost   = sum(lineCost = rate × quantity)
 *   contingency     = totalLineCost × contingencyPct   (on DIRECT COST only)
 *   overhead        = totalLineCost × overheadPct       (on DIRECT COST only)
 *   totalCost       = totalLineCost + overhead + contingency
 *   profit          = totalCost × targetProfitRatio     (markup mode)
 *                  OR sellPrice = totalCost / (1 - targetProfitRatio)  (margin mode)
 *   sellPrice       = totalCost + profit                 (markup mode)
 *                  OR totalCost / (1 - targetProfitRatio)  (margin mode)
 *   grossProfit     = sellPrice - totalCost
 *   grossMargin     = grossProfit / sellPrice
 *
 * The CANONICAL sell price is estimate-level (not per-line). Per-line
 * pricingStrategy + pricingRatio are adjustment metadata; they do NOT
 * determine the canonical sell price. (Phase 2A.1 H2 decision.)
 *
 * Overhead is calculated on DIRECT COST ONLY (not direct + contingency).
 * This is an INTENTIONAL CHANGE from legacy Contros, which calculated
 * overhead on (direct + contingency). (Phase 2A.1 H1 decision.)
 *
 * PURE contract — no persistence, no UI, no Electron.
 */

import type { RevisionMetadata } from '../types.js'
import type { EstimateLine } from './estimate-line.js'
import type { Money, CurrencyCode } from './money.js'
import type { Ratio } from './pricing.js'
import {
  computeTotals,
  extendLine,
  grossMargin,
  ratio,
} from './pricing.js'
import { multiply, add, subtract, divide } from './money.js'
import { contentHash } from '../hashing.js'

/**
 * TargetProfitMode — how the estimate-level profit is calculated.
 *
 * - 'markup': profit = totalCost × targetProfitRatio; sellPrice = totalCost + profit.
 *   Example: cost=1000, ratio=0.10 → profit=100, sell=1100.
 *
 * - 'margin': sellPrice = totalCost / (1 - targetProfitRatio); profit = sellPrice - totalCost.
 *   Example: cost=1000, ratio=0.10 → sell=1111.11, profit=111.11.
 */
export type TargetProfitMode = 'markup' | 'margin'

/**
 * EstimatePricingPolicy — the estimate-level commercial policy.
 *
 * This is the CANONICAL pricing authority. The sell price is computed from
 * the total cost + this policy, NOT from per-line markup/margin. Per-line
 * pricingStrategy + pricingRatio remain on EstimateLine as adjustment
 * metadata but do NOT determine the canonical sell price.
 * (Phase 2A.1 H2 decision.)
 */
export interface EstimatePricingPolicy {
  readonly overheadPct: Ratio        // overhead recovery on DIRECT COST only
  readonly contingencyPct: Ratio       // contingency on DIRECT COST only
  readonly targetProfitMode: TargetProfitMode
  readonly targetProfitRatio: Ratio   // the markup or margin ratio
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
  readonly policy: EstimatePricingPolicy
  readonly lines: readonly EstimateLine[]
  /** A free-form note captured at finalization (part of the snapshot). */
  readonly note: string | null
  /** The algorithm version of the pricing engine that computed the derived fields. */
  readonly pricingAlgorithmVersion: string
}

/**
 * An EstimateRevision — the full canonical authority.
 */
export interface EstimateRevision {
  readonly __brand: 'EstimateRevision'
  readonly metadata: RevisionMetadata
  readonly payload: EstimateRevisionPayload
}

/**
 * Compute the canonical content hash of an EstimateRevisionPayload.
 * Same payload → same hash. (Phase 2A §13; master §14/§15.)
 */
export function estimateRevisionContentHash(payload: EstimateRevisionPayload): string {
  return contentHash(payload)
}

/**
 * EstimateRevisionTotals — the derived commercial result.
 */
export interface EstimateRevisionTotals {
  readonly totalLineCost: Money
  readonly overhead: Money
  readonly contingency: Money
  readonly totalCost: Money            // line cost + overhead + contingency
  readonly profit: Money               // estimate-level profit
  readonly sellPrice: Money            // totalCost + profit (markup) or totalCost/(1-margin) (margin)
  readonly grossProfit: Money          // sellPrice - totalCost (= profit)
  readonly grossMargin: Ratio          // grossProfit / sellPrice
}

/**
 * Compute the estimate totals from an EstimateRevisionPayload.
 *
 * Commercial model (Phase 2A.1):
 *   totalLineCost = sum(lineCost)
 *   contingency   = totalLineCost × contingencyPct   (H1: on direct cost only)
 *   overhead      = totalLineCost × overheadPct       (H1: on direct cost only)
 *   totalCost     = totalLineCost + overhead + contingency
 *   profit (markup)  = totalCost × targetProfitRatio; sellPrice = totalCost + profit
 *   profit (margin)  = sellPrice - totalCost; sellPrice = totalCost / (1 - targetProfitRatio)
 *   grossProfit   = sellPrice - totalCost
 *   grossMargin   = grossProfit / sellPrice
 */
export function computeEstimateRevisionTotals(payload: EstimateRevisionPayload): EstimateRevisionTotals {
  // Per-line costs (rate × quantity, or lump-sum)
  const lines = payload.lines.map((l) => ({
    cost: lineCostOf(l),
    sellPrice: lineSellPriceOf(l), // informational per-line sell; NOT the canonical sell
  }))
  const lineTotals = computeTotals(lines, payload.currency)

  // H1: overhead and contingency on DIRECT COST ONLY (totalLineCost).
  // Legacy Contros calculated overhead on (direct + contingency); this is
  // an INTENTIONAL CHANGE. (Phase 2A.1 H1 decision.)
  const overhead = multiply(lineTotals.totalCost, payload.policy.overheadPct)
  const contingency = multiply(lineTotals.totalCost, payload.policy.contingencyPct)
  const totalCost = add(add(lineTotals.totalCost, overhead), contingency)

  // H2: canonical sell price is ESTIMATE-LEVEL (not per-line).
  // profit = totalCost × ratio (markup) or sellPrice = totalCost/(1-ratio) (margin).
  let profit: Money
  let sellPrice: Money
  if (payload.policy.targetProfitMode === 'margin') {
    // margin: sellPrice = totalCost / (1 - ratio); profit = sellPrice - totalCost
    sellPrice = divide(totalCost, 1 - payload.policy.targetProfitRatio)
    profit = subtract(sellPrice, totalCost)
  } else {
    // markup: profit = totalCost × ratio; sellPrice = totalCost + profit
    profit = multiply(totalCost, payload.policy.targetProfitRatio)
    sellPrice = add(totalCost, profit)
  }

  const grossProfit = subtract(sellPrice, totalCost)

  return {
    totalLineCost: lineTotals.totalCost,
    overhead,
    contingency,
    totalCost,
    profit,
    sellPrice,
    grossProfit,
    grossMargin: grossMargin(sellPrice, totalCost),
  }
}

/**
 * Replay an EstimateRevision: reconstruct the exact commercial result
 * from the immutable payload. Same payload + same algorithmVersion = same
 * totals. (Phase 2A §13.)
 */
export function replayEstimateRevision(revision: EstimateRevision): EstimateRevisionTotals {
  return computeEstimateRevisionTotals(revision.payload)
}

/**
 * Verify that a revision's stored content hash matches a recomputed hash.
 */
export function verifyEstimateRevisionHash(revision: EstimateRevision, expectedHash: string): boolean {
  return estimateRevisionContentHash(revision.payload) === expectedHash
}

/**
 * Create an EstimateRevisionPayload. Enforces the single-currency invariant:
 * every EstimateLine's currency must match the payload's currency. A
 * mixed-currency payload throws immediately — it must NEVER become hashable
 * canonical content. (Phase 2A.1 M2 fix.)
 */
export function estimateRevisionPayload(input: {
  projectId: string
  currency: CurrencyCode
  policy: EstimatePricingPolicy
  lines: readonly EstimateLine[]
  note?: string | null
  pricingAlgorithmVersion: string
}): EstimateRevisionPayload {
  if (!input.projectId) throw new Error('EstimateRevisionPayload: projectId required')
  if (!input.pricingAlgorithmVersion) throw new Error('EstimateRevisionPayload: pricingAlgorithmVersion required')

  // M2: enforce single-currency invariant at construction time
  for (const line of input.lines) {
    if (line.currency !== input.currency) {
      throw new Error(
        `EstimateRevisionPayload currency mismatch: payload currency is ${input.currency} but line ${line.lineId} has currency ${line.currency}. ` +
          `A mixed-currency payload is invalid and cannot become canonical content.`,
      )
    }
  }

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

// ── local line-cost (mirrors estimate-line.ts; deterministic) ──

function lineCostOf(line: EstimateLine): Money {
  if (line.costBasis === 'lump-sum' || line.costBasis === 'provisional') {
    return line.rate
  }
  return extendLine(line.rate, line.quantity)
}

/**
 * Per-line sell price — INFORMATIONAL ONLY.
 *
 * This is NOT the canonical sell price. The canonical sell price is
 * estimate-level (totalCost + profit from the pricing policy). The per-line
 * sell price is computed here for reference/adjustment purposes only.
 * (Phase 2A.1 H2: line-level pricing is adjustment metadata, not authority.)
 *
 * If the exact interaction between per-line pricing and the estimate-level
 * policy cannot be defined without Pricing Knowledge, this remains an
 * informational computation. The canonical authority is the estimate-level
 * policy.
 */
function lineSellPriceOf(line: EstimateLine): Money {
  const cost = lineCostOf(line)
  // Per-line pricing is kept as adjustment metadata; this computation
  // is informational only and does NOT define the canonical sell price.
  if (line.pricingStrategy === 'markup') {
    return multiply(cost, 1 + line.pricingRatio)
  }
  return divide(cost, 1 - line.pricingRatio)
}
