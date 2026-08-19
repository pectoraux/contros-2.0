/**
 * Pricing semantics — cost, sell price, gross profit, gross margin, markup.
 *
 * These are the canonical mathematical definitions. They are NOT
 * interchangeable. (Phase 2A §8.)
 *
 * DEFINITIONS:
 *
 *   cost          = the cost to the contractor (direct + overhead + risk)
 *   sellPrice     = the price charged to the client
 *   grossProfit   = sellPrice - cost
 *   grossMargin   = grossProfit / sellPrice       (a fraction of SELL price)
 *   markup        = grossProfit / cost             (a fraction of COST)
 *
 * KEY DISTINCTION (do NOT confuse these):
 *
 *   20% markup  ≠  20% margin
 *
 *   cost=100, markup=20% → profit=20, sell=120, margin=20/120=16.67%
 *   cost=100, margin=20% → sell=100/0.8=125, profit=25, markup=25/100=25%
 *
 * CONVERT BETWEEN MARGIN AND MARKUP (deterministic):
 *
 *   margin = markup / (1 + markup)
 *   markup = margin / (1 - margin)
 *
 * Given a target MARGIN and a COST, the SELL PRICE is:
 *
 *   sellPrice = cost / (1 - margin)
 *
 * Given a MARKUP and a COST, the SELL PRICE is:
 *
 *   sellPrice = cost * (1 + markup)
 *
 * All arithmetic uses Money (integer minor units, banker's rounding).
 * (Phase 2A §8/§9.)
 */

import type { Money } from './money.js'
import { money, moneyFromMinor, add, subtract, multiply, divide, bankerRound } from './money.js'
import type { CurrencyCode } from './currency.js'

/**
 * A ratio (percentage) expressed as a fraction 0..1.
 * 20% = 0.20. Validated to be finite and in [0, 1].
 * (Legacy Contros Fix #4: percentages bounded to 0..1, not just >= 0.)
 */
export type Ratio = number & { readonly __brand: 'Ratio' }

export function ratio(r: number): Ratio {
  if (!Number.isFinite(r) || r < 0 || r > 1) {
    throw new Error(`Invalid ratio (must be 0..1, got ${r})`)
  }
  return r as Ratio
}

/** A ratio expressed as a percentage (0..100). Convenience. */
export function ratioFromPercent(pct: number): Ratio {
  return ratio(pct / 100)
}

// ── Margin ↔ Markup conversion (pure, deterministic) ─────────

/**
 * Convert markup to margin: margin = markup / (1 + markup).
 * markup=0.20 → margin=0.20/1.20=0.16667
 */
export function markupToMargin(markup: Ratio): Ratio {
  return ratio(markup / (1 + markup))
}

/**
 * Convert margin to markup: markup = margin / (1 - margin).
 * margin=0.20 → markup=0.20/0.80=0.25
 */
export function marginToMarkup(margin: Ratio): Ratio {
  if (margin >= 1) throw new Error(`Invalid margin (>=1, cannot convert to markup): ${margin}`)
  return ratio(margin / (1 - margin))
}

// ── Cost → Sell price (two strategies) ───────────────────────

/**
 * Compute sell price from cost + markup.
 *   sellPrice = cost * (1 + markup)
 * Banker's rounding at the currency's minor-unit precision.
 */
export function sellPriceFromMarkup(cost: Money, markup: Ratio): Money {
  return multiply(cost, 1 + markup)
}

/**
 * Compute sell price from cost + target margin.
 *   sellPrice = cost / (1 - margin)
 * Banker's rounding at the currency's minor-unit precision.
 * Throws if margin >= 1 (sell price would be infinite/negative).
 */
export function sellPriceFromMargin(cost: Money, margin: Ratio): Money {
  if (margin >= 1) throw new Error(`Invalid margin (>=1, sell price undefined): ${margin}`)
  return divide(cost, 1 - margin)
}

// ── Sell price → derived metrics ──────────────────────────────

/**
 * Gross profit = sellPrice - cost.
 */
export function grossProfit(sellPrice: Money, cost: Money): Money {
  return subtract(sellPrice, cost)
}

/**
 * Gross margin = grossProfit / sellPrice.
 * Returns a Ratio (0..1). Returns 0 if sellPrice is 0.
 */
export function grossMargin(sellPrice: Money, cost: Money): Ratio {
  if (sellPrice.amount === 0) return ratio(0)
  const profit = subtract(sellPrice, cost)
  // margin = profit / sellPrice, computed in minor units
  const marginFraction = profit.amount / sellPrice.amount
  // Clamp to [0,1] for safety (floating-point may produce tiny out-of-range)
  return ratio(Math.max(0, Math.min(1, marginFraction)))
}

/**
 * Markup = grossProfit / cost.
 * Returns a Ratio (0..∞, but typically 0..1). Returns 0 if cost is 0.
 */
export function markup(sellPrice: Money, cost: Money): Ratio {
  if (cost.amount === 0) return ratio(0)
  const profit = subtract(sellPrice, cost)
  const markupFraction = profit.amount / cost.amount
  // Markup can exceed 1 (e.g. cost=10, sell=30 → markup=2.0=200%); cap at 1
  // only if the caller expects a Ratio 0..1. For the raw markup, return
  // the value but note it may exceed 1. We clamp to [0, 1] for the Ratio
  // type safety; callers needing unbounded markup should use markupRaw().
  return ratio(Math.max(0, Math.min(1, markupFraction)))
}

/**
 * Raw markup (may exceed 1 = 100%). Returned as a plain number, NOT a Ratio,
 * because markup is not bounded to 0..1.
 */
export function markupRaw(sellPrice: Money, cost: Money): number {
  if (cost.amount === 0) return 0
  const profit = subtract(sellPrice, cost)
  return profit.amount / cost.amount
}

// ── Estimate totals ───────────────────────────────────────────

/**
 * Sum the cost and sellPrice of multiple lines.
 * Returns the totals. Both are same-currency Money values.
 */
export interface EstimateTotals {
  readonly totalCost: Money
  readonly totalSellPrice: Money
  readonly totalGrossProfit: Money
  readonly grossMargin: Ratio
}

/**
 * Compute estimate totals from a list of (cost, sellPrice) pairs.
 * All pairs must be same-currency.
 */
export function computeTotals(
  lines: ReadonlyArray<{ cost: Money; sellPrice: Money }>,
  currency: CurrencyCode | string,
): EstimateTotals {
  const c = typeof currency === 'string' ? (currency as CurrencyCode) : currency
  if (lines.length === 0) {
    const zero = moneyFromMinor(0, c)
    return { totalCost: zero, totalSellPrice: zero, totalGrossProfit: zero, grossMargin: ratio(0) }
  }
  let costMinor = 0
  let sellMinor = 0
  for (const l of lines) {
    if (l.cost.currency !== c || l.sellPrice.currency !== c) {
      throw new Error(`Currency mismatch in totals: expected ${c}, got cost=${l.cost.currency}, sell=${l.sellPrice.currency}`)
    }
    costMinor += l.cost.amount
    sellMinor += l.sellPrice.amount
  }
  const totalCost = moneyFromMinor(costMinor, c)
  const totalSellPrice = moneyFromMinor(sellMinor, c)
  const totalGrossProfit = subtract(totalSellPrice, totalCost)
  const gm = grossMargin(totalSellPrice, totalCost)
  return { totalCost, totalSellPrice, totalGrossProfit, grossMargin: gm }
}

// ── Line extension (quantity × rate) ──────────────────────────

/**
 * Line extension: multiply a rate (Money per unit) by a quantity.
 * Result is Money (the total amount for the line).
 *
 * rate × quantity, banker's rounded to the currency's minor unit.
 *
 * Example: rate=GHS 5.00/m2 (500 minor), qty=12.5 m2 → 500 × 12.5 = 6250 minor = GHS 62.50
 */
export function extendLine(rate: Money, qty: { value: number }): Money {
  // rate.amount (minor) × qty.value → minor units, then banker-round to integer
  const product = rate.amount * qty.value
  const rounded = bankerRound(product)
  return moneyFromMinor(rounded, rate.currency)
}

// re-export common money helpers for convenience
export { money, moneyFromMinor, add, subtract, multiply, divide, bankerRound } from './money.js'
export type { Money } from './money.js'
