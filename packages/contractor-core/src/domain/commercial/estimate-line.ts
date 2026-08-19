/**
 * EstimateLine — the minimal canonical line of an estimate.
 *
 * Separates: quantity, unit, cost basis, rate, markup/margin, allowances,
 * tax, adjustments. (Phase 2A §7.)
 *
 * The line's financial calculation is deterministic: given the same inputs
 * + algorithm version, the same cost/sell/extension result. (master §14.)
 *
 * PURE contract — no persistence, no UI, no Electron.
 */

import type { Quantity } from './quantity.js'
import type { Money, CurrencyCode } from './money.js'
import type { Ratio } from './pricing.js'
import { extendLine, sellPriceFromMarkup, sellPriceFromMargin, grossProfit, grossMargin, ratio } from './pricing.js'

export type CostBasis =
  | 'unit-rate'         // rate per unit (quantity × rate)
  | 'lump-sum'           // fixed amount regardless of quantity
  | 'provisional'        // provisional sum (allowance)
  | 'scheduled'          // scheduled rate (from a schedule of rates)

export type PricingStrategy =
  | 'markup'             // sellPrice = cost × (1 + markup)
  | 'margin'             // sellPrice = cost / (1 - margin)

/**
 * An EstimateLine — one priced line of an estimate.
 *
 * The line carries its OWN pricing strategy (markup or margin) and rate,
 * so the estimate is self-contained and replayable. (Phase 2A §13.)
 */
export interface EstimateLine {
  readonly __brand: 'EstimateLine'
  readonly lineId: string
  readonly boqItemId: string | null  // link to BOQItem (reference, not authority)
  readonly description: string
  readonly quantity: Quantity
  readonly costBasis: CostBasis
  /** Unit rate (cost per unit). For lump-sum, this is the total cost. */
  readonly rate: Money
  readonly pricingStrategy: PricingStrategy
  /** The markup or margin ratio (depending on pricingStrategy). */
  readonly pricingRatio: Ratio
  readonly currency: CurrencyCode
}

/**
 * Compute the line cost (quantity × rate, or lump-sum).
 * Returns a Money value.
 */
export function lineCost(line: EstimateLine): Money {
  if (line.costBasis === 'lump-sum' || line.costBasis === 'provisional') {
    return line.rate
  }
  // unit-rate / scheduled: rate × quantity
  return extendLine(line.rate, line.quantity)
}

/**
 * Compute the line sell price based on the pricing strategy.
 * Returns a Money value (banker's-rounded).
 */
export function lineSellPrice(line: EstimateLine): Money {
  const cost = lineCost(line)
  if (line.pricingStrategy === 'markup') {
    return sellPriceFromMarkup(cost, line.pricingRatio)
  }
  // margin — pricingRatio already validated < 1 in estimateLine()
  return sellPriceFromMargin(cost, line.pricingRatio)
}

/**
 * Compute the line's gross profit (sellPrice - cost).
 */
export function lineGrossProfit(line: EstimateLine): Money {
  return grossProfit(lineSellPrice(line), lineCost(line))
}

/**
 * Compute the line's gross margin (grossProfit / sellPrice).
 * Returns a plain number (may be negative if sellPrice < cost — a loss).
 * (Phase 2A.2 Me2 fix: no silent clamping.)
 */
export function lineGrossMargin(line: EstimateLine): number {
  return grossMargin(lineSellPrice(line), lineCost(line))
}

export function estimateLine(input: {
  lineId: string
  boqItemId: string | null
  description: string
  quantity: Quantity
  costBasis: CostBasis
  rate: Money
  pricingStrategy: PricingStrategy
  pricingRatio: Ratio
}): EstimateLine {
  if (!input.lineId) throw new Error('EstimateLine: lineId required')
  if (!input.description) throw new Error('EstimateLine: description required')
  if (input.pricingStrategy === 'margin' && input.pricingRatio >= 1) {
    throw new Error(`EstimateLine: margin must be < 1, got ${input.pricingRatio}`)
  }
  return {
    __brand: 'EstimateLine',
    lineId: input.lineId,
    boqItemId: input.boqItemId,
    description: input.description,
    quantity: input.quantity,
    costBasis: input.costBasis,
    rate: input.rate,
    pricingStrategy: input.pricingStrategy,
    pricingRatio: input.pricingRatio,
    currency: input.rate.currency,
  } as EstimateLine
}
