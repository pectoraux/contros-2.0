/**
 * Pricing semantics tests — cost, margin, markup, sell price.
 *
 * Proves the KEY DISTINCTION: 20% margin ≠ 20% markup. (Phase 2A §8.)
 *
 * Pure, deterministic. No DB, no network, no filesystem.
 */

import { describe, it, expect } from 'vitest'
import {
  ratio, ratioFromPercent, markupToMargin, marginToMarkup,
  sellPriceFromMarkup, sellPriceFromMargin,
  grossProfit, grossMargin, markup, markupRaw,
  computeTotals, extendLine,
} from '../../../src/domain/commercial/pricing.js'
import { money, moneyFromMinor, isEqual, toDecimal } from '../../../src/domain/commercial/money.js'

describe('Pricing: margin vs markup distinction (CRITICAL)', () => {
  it('20% markup ≠ 20% margin', () => {
    const cost = money(100.00, 'GHS')
    // 20% markup: sell = 100 × 1.2 = 120
    const sellFromMarkup = sellPriceFromMarkup(cost, ratio(0.20))
    // 20% margin: sell = 100 / 0.8 = 125
    const sellFromMargin = sellPriceFromMargin(cost, ratio(0.20))
    expect(toDecimal(sellFromMarkup)).toBeCloseTo(120.00, 2)
    expect(toDecimal(sellFromMargin)).toBeCloseTo(125.00, 2)
    expect(isEqual(sellFromMarkup, sellFromMargin)).toBe(false)
  })

  it('markup=20% → margin=16.67% (not 20%)', () => {
    const cost = money(100.00, 'GHS')
    const sell = sellPriceFromMarkup(cost, ratio(0.20)) // 120
    const gm = grossMargin(sell, cost) // (120-100)/120 = 0.16667
    expect(gm).toBeCloseTo(0.16667, 4)
  })

  it('margin=20% → markup=25% (not 20%)', () => {
    const cost = money(100.00, 'GHS')
    const sell = sellPriceFromMargin(cost, ratio(0.20)) // 125
    const mu = markupRaw(sell, cost) // (125-100)/100 = 0.25
    expect(mu).toBeCloseTo(0.25, 4)
  })
})

describe('Pricing: margin ↔ markup conversion', () => {
  it('markup → margin → markup (round-trip)', () => {
    const mu = ratio(0.20)
    const mg = markupToMargin(mu)
    const mu2 = marginToMarkup(mg)
    expect(mu2).toBeCloseTo(mu, 5)
  })

  it('margin → markup → margin (round-trip)', () => {
    const mg = ratio(0.25)
    const mu = marginToMarkup(mg)
    const mg2 = markupToMargin(mu)
    expect(mg2).toBeCloseTo(mg, 5)
  })

  it('ratioFromPercent', () => {
    expect(ratioFromPercent(20)).toBeCloseTo(0.20, 5)
    expect(ratioFromPercent(0)).toBe(0)
    expect(ratioFromPercent(100)).toBe(1)
  })

  it('ratio rejects out-of-range', () => {
    expect(() => ratio(-0.01)).toThrow()
    expect(() => ratio(1.01)).toThrow()
    expect(() => ratio(NaN)).toThrow()
  })
})

describe('Pricing: cost → sell price', () => {
  it('sellPriceFromMarkup: cost=100, markup=10% → sell=110', () => {
    const sell = sellPriceFromMarkup(money(100.00, 'GHS'), ratio(0.10))
    expect(toDecimal(sell)).toBeCloseTo(110.00, 2)
  })

  it('sellPriceFromMargin: cost=100, margin=10% → sell=111.11', () => {
    const sell = sellPriceFromMargin(money(100.00, 'GHS'), ratio(0.10))
    expect(toDecimal(sell)).toBeCloseTo(111.11, 2)
  })

  it('sellPriceFromMargin throws on margin >= 1', () => {
    expect(() => sellPriceFromMargin(money(100, 'GHS'), ratio(1))).toThrow()
  })
})

describe('Pricing: sell → derived metrics', () => {
  it('grossProfit = sell - cost', () => {
    const profit = grossProfit(money(120, 'GHS'), money(100, 'GHS'))
    expect(toDecimal(profit)).toBeCloseTo(20.00, 2)
  })

  it('grossMargin = profit / sell', () => {
    const gm = grossMargin(money(120, 'GHS'), money(100, 'GHS'))
    expect(gm).toBeCloseTo(0.16667, 4) // 20/120
  })

  it('zero sell price → zero margin', () => {
    const gm = grossMargin(money(0, 'GHS'), money(100, 'GHS'))
    expect(gm).toBe(0)
  })
})

describe('Pricing: line extension (rate × quantity)', () => {
  it('rate × quantity = extension', () => {
    // rate = GHS 5.00/m2 (500 minor), qty = 12.5 m2 → 62.50
    const rate = money(5.00, 'GHS')
    const qty = { value: 12.5 }
    const ext = extendLine(rate, qty)
    expect(toDecimal(ext)).toBeCloseTo(62.50, 2)
  })

  it('fractional extension banker\'s-rounded', () => {
    // rate = GHS 3.33/m (333 minor), qty = 10 m → 3330 = 33.30
    const ext = extendLine(money(3.33, 'GHS'), { value: 10 })
    expect(toDecimal(ext)).toBeCloseTo(33.30, 2)
  })
})

describe('Pricing: estimate totals', () => {
  it('computeTotals sums cost + sellPrice + profit + margin', () => {
    const lines = [
      { cost: money(100, 'GHS'), sellPrice: money(120, 'GHS') },
      { cost: money(200, 'GHS'), sellPrice: money(250, 'GHS') },
    ]
    const totals = computeTotals(lines, 'GHS')
    expect(toDecimal(totals.totalCost)).toBeCloseTo(300.00, 2)
    expect(toDecimal(totals.totalSellPrice)).toBeCloseTo(370.00, 2)
    expect(toDecimal(totals.totalGrossProfit)).toBeCloseTo(70.00, 2)
    expect(totals.grossMargin).toBeCloseTo(70 / 370, 4) // 0.1892
  })

  it('computeTotals empty → zero', () => {
    const totals = computeTotals([], 'GHS')
    expect(toDecimal(totals.totalCost)).toBe(0)
    expect(toDecimal(totals.totalSellPrice)).toBe(0)
  })

  it('computeTotals rejects cross-currency lines', () => {
    const lines = [
      { cost: money(100, 'GHS'), sellPrice: money(120, 'GHS') },
      { cost: money(100, 'USD'), sellPrice: money(120, 'USD') },
    ]
    expect(() => computeTotals(lines, 'GHS')).toThrow(/currency mismatch/i)
  })
})
